//  ribs.js
//  (c) 2011 Zendesk Inc.
//  Ribs may be freely distributed under the MIT license.

/*globals _, Backbone*/
(function(exports) {
  var Ribs = exports.Ribs = exports.Ribs || {};
  Ribs.Mixins = Ribs.Mixins || {};

  var originalExtend = Backbone.Model.extend;

  if (Backbone.Model.extend !== Backbone.Collection.extend ||
      Backbone.Model.extend !== Backbone.Controller.extend ||
      Backbone.Model.extend !== Backbone.View.extend) {
    throw new Error('Ribs is not compatible with this version of Backbone');
  }

  // ## Extend Extensions
  // Enhances the `extend` function of Backbone classes. This is the
  // only mixin in Vertebrae that is mixed in automatically, as it is
  // required for all of the others to function.
  //
  // ### `afterExtend`
  // When extending a class, any function passed in as `afterExtend`
  // in either the prototype or class properties will be called after
  // the class is extended.
  //
  // #### Example:
  //
  //     var LoggingMixin = {
  //       afterExtend: function(klass) {
  //         console.log('LoggingMixin mixed into ' + klass);
  //       }
  //     };
  //
  //     MyModel = Backbone.Model
  //       .extend(LoggingMixin);
  //     // 'LoggingMixin mixed into MyModel'
  //
  // ### extend with functions
  //
  // Sometimes, extending with an object literal is not enough. After adding
  // `ExtendExtensions` to a class, the class's `extend` function can take
  // a function instead of an object literal as either argument. The function
  // will be called in the scope of the parent class and should return
  // an object literal that is then mixed in.
  //
  // #### Example:
  //
  //     MyModel = Backbone.Model
  //       .extend(function(parent) {
  //         var originalRender = parent.prototype.render;
  //         return {
  //           render: function() {
  //             var result = originalRender.call(this);
  //             // do stuff after the render call
  //             return result;
  //           }
  //         };
  //       });
  Ribs.Mixins.ExtendExtensions = {
    extend: function(protoProps, classProps) {
      if (_.isFunction(protoProps)) { protoProps = protoProps.call(this); }
      if (_.isFunction(classProps)) { classProps = classProps.call(this); }
      var child = originalExtend.call(this, protoProps, classProps);
      _([protoProps, classProps]).each(function(props) {
        if (props && props.afterExtend) { props.afterExtend(child); }
      });
      return child;
    }
  };

  Backbone.Model.extend = Backbone.Collection.extend = Backbone.Controller.extend =
    Backbone.View.extend = Ribs.Mixins.ExtendExtensions.extend;

}(this));

/*globals _, Backbone*/
(function(exports) {
  var Ribs = exports.Ribs = exports.Ribs || {};
  Ribs.Mixins = Ribs.Mixins || {};

  // Extend Backbone's #get method to handle object paths. Paths of the form
  // "first_level.second_level.attribute" can be used to address contained objects.
  // This also works if any segment of the path refers to a computed property.
  // ### Example
  //     var foo = new SomeModel();
  //     var bar = new SomeOtherModel({name: "Bar"});
  //     foo.set({child: bar});
  //     foo.get("child.name"); //=> "Bar"
  //
  // See `Backbone.Binding`
  Ribs.Mixins.ObjectPaths = {
    afterExtend: function(klass) {
      klass.prototype.get = _.wrap(klass.prototype.get, function(func, path) {
        if(path.match(/.+\./)) {
          return Backbone.Binding.objectAtPath(path, this);
        } else {
          return func.call(this, path);
        }
      });

      if(!_.isFunction(klass.prototype.set)) { return; }

      klass.prototype.set = _.wrap(klass.prototype.set, function(func, attrs, options) {
        var pathAttrs = {};
        var normalAttrs = {};
        _(attrs).each(function(value, key) {
          if(key.match(/.+\./)) {
            pathAttrs[key] = value;
          } else {
            normalAttrs[key] = value;
          }
        });

        if(!_.isEmpty(normalAttrs)) {
          func.call(this, normalAttrs, options);
        }

        _(pathAttrs).each(function(value, key) {
          var parts = Backbone.Binding.splitPath(key);
          var obj = Backbone.Binding.objectAtPath(parts[0], this);
          var attrToSet = {};
          attrToSet[parts[1]] = value;
          if(obj) { obj.set(attrToSet, options); }
        }, this);

        return this;
      });

    }

  };

}(this));

/*globals Backbone, _, Ribs, $*/
(function() {
  // Various behaviors that can be mixed in to classes.

  Backbone.Mixins = {};

  // ## `EventTargetProxy`
  // **Private**. A helper class for `Backbone.Mixins.Event#forwards`.
  // `stub` requires a `#bind` method.
  function EventTargetProxy(stub, eventNames) {
    this.to = function(targetAddress) {
      eventNames.each(function(eventName) {
        stub.bind(eventName, function() {
          var target = Backbone.Binding.objectAtPath(targetAddress);
          var args = Array.prototype.slice.call(arguments);
          args.unshift(eventName);
          if(target) { target.trigger.apply(target, args); }
        });
      });
      return stub;
    };
  }

  // ## Event
  Backbone.Mixins.Event = {
  // ### bindMultiple
  // Adds support for binding multiple events to the same handler in one shot.
  // ### Example
  //     collectionObj.bindMultiple("add", "refresh", function() {
  //       //Handle add or refresh on the collection.
  //     });
    bindMultiple: function(events, callback) {
      _(events).each(function(event) {
        this.bind(event, callback);
      }, this);
    },

  // ### bindChangeOnPath
  // Adds support for binding a change event to an object path.
  // ### Example
  //     var User = Ribs.Model.extend({});
  //     var a = new User({name: "Foo"});
  //     var b = new User({name: "Bar"});
  //     b.set({child: a});
  //     b.bindChangeOnPath("child.name", function() { console.log("Foo"); })
  //     a.set({name: "BAR"}) //=> fires the callback above
    bindChangeOnPath: function(path, callback, pathRoot) {

      if(!pathRoot) {
        pathRoot = this;
      }

      var objects = Backbone.Binding.objectsAtPath(path, pathRoot);

      if(!objects.length) {
        return this;
      }

      var pathComponents = path.split(".");

      // Given pathRoot = {b: {c: {d: 'foo'}}}, and path = "b.c.d",
      // this produces: [[a, 'b'], [b, 'c'], [c, 'd'], ['foo', undefined]]
      // This representation of the object path is used as the basis of
      // setting up and tearing down event handlers.
      var pairs = _.zip(objects, pathComponents);

      _(pairs).each(function(pair, idx) {
        var parentObject = pair[0];
        var childKey = pair[1];

        if(!(parentObject || {}).bindChangeOnPath) { return; }

        var remainingPath = pathComponents.slice(idx+1).join(".");
        var eventToBind = "change";

        if(childKey) {
          eventToBind = "change:" + childKey;
        }

        var newCallback = this._wrapCallback(callback, childKey, remainingPath);
        var chainedCallbacks = parentObject._chainedCallbacks || (parentObject._chainedCallbacks = {});
        chainedCallbacks[callback] = newCallback;
        parentObject.bind(eventToBind, newCallback);

      }, this);

      return this;
    },

      // We wrap the supplied callback in a wrapper that, when triggered:
      // 1. Sets up the path callbacks on the new object/value
      // 2. Calls the original callback
    _wrapCallback: function(handler, currentKey, remainingPath) {
      return _.wrap(handler, function(func) {
        var args = Array.prototype.slice.call(arguments, 1);

        var obj = args[0];
        var newVal = args[1];

          // First disconnect any existing chain on the outgoing value.
        var oldVal = obj._previousAttributes[currentKey];
        if(oldVal && oldVal.unbindChangeOnPath) {
          oldVal.unbindChangeOnPath(remainingPath, handler);
        }

        // Connect chain on the incoming value
        if(newVal && newVal.bindChangeOnPath) {
          newVal.bindChangeOnPath(remainingPath, handler);
        }

        //And call the event handler
        return handler.apply(this, args);
      });
    },

    unbindChangeOnPath: function(path, callback, pathRoot) {
      var callbackToUnbind;

      if(!pathRoot) {
        pathRoot = this;
      }

      var objects = Backbone.Binding.objectsAtPath(path, pathRoot);

      if(!objects.length) {
        return this;
      }

      var pathComponents = path.split(".");
      var pairs = _.zip(objects, pathComponents);

      _(pairs).each(function(pair, idx) {
        var parentObject = pair[0];
        var childKey = pair[1];
        if(!(parentObject || {}).unbindChangeOnPath) { return; }

        var eventToUnbind = "change";
        if(childKey) {
          eventToUnbind = "change:" + childKey;
        }

        if (parentObject._chainedCallbacks &&
            parentObject._chainedCallbacks[callback]) {
          callbackToUnbind = parentObject._chainedCallbacks[callback];
        } else {
          callbackToUnbind = callback;
        }

        parentObject.unbind(eventToUnbind, callbackToUnbind);
      }, this);

      return this;
    },


    // ### Event Forwarding
    // Forward events triggered on this object to another object.
    // The other object is located by path (e.g. "MyApp.MyController.aModel").
    //
    // #### Example:
    //
    //     window.MyApp.someGlobalModel = new Backbone.Model({...})
    //     ...
    //     var MyController = Backbone.Controller
    //       .extend(Backbone.Mixins.Event)
    //     var myController = new MyController();
    //     myController
    //       .forwards('an-event', 'another-event')
    //       .to('MyApp.someGlobalModel');
    //
    // **N.B.** the `.to(objectPath)` call. `forwards` by itself does not
    // set up any forwarding. It *must* be combined with a subsequent call
    // to `to` on the return value of `forwards`.
    forwards: function() {
      return new EventTargetProxy(this, _(arguments));
    }
  };

  // ## AttributeBinding
  // Adds support for creating a two-way link between two attributes. Changes to either will be synced
  // to the other.
  //
  // ### Example
  //     var SomeKlass = Backbone.Model
  //       .extend(Backbone.Mixins.AttributeBinding).extend();
  //
  //     window.someKlassObject = new SomeKlass();
  //     window.someKlassObject.set({foo: "bar", bar: "bar"});
  //
  //     var SomeOtherKlass = Backbone.Model
  //       .extend(Backbone.Mixins.AttributeBinding).extend({
  //       fooBinding: "someKlassObject.foo", //Implicit binding
  //       bar: Backbone.Binding.to("someKlassObject.bar") //Explicit
  //     });
  //
  //     var boundObject = new SomeOtherKlass();
  //     someKlassObject.set({foo: "BAR", bar: "BAR"});
  //
  //     boundObject.get("foo"); //=> "BAR"
  //     boundObject.get("bar"); //=> "bar"
  //
  //See also `Backbone.Binding`
  Backbone.Mixins.AttributeBinding = {
    afterExtend: function(klass) {
      klass.prototype.initialize = _.wrap(klass.prototype.initialize, function(func, attributes) {
        func.call(this, attributes);
        this.connectAttributeBindings();
      });
    },

    // Explicitly set up a binding from an attribute of the calling object to an object at the provided path.
    // ### Parameters
    // * `attr` (`String`) -- the name of the attribute in the calling object that is going to be bound to another attribute.
    // * `toPath` (`String`) the object path to the attribute to which "attr" should be linked to.
    // * `toRoot` (`Object`) (Optional) toRoot the context in which the object path "toPath" should be evaluated. Defaults to window.
    //
    // ### Example
    //     var obj1 = new SomeModel({name: "Foo"});
    //     var obj2 = new SomeOtherModel({label: "Bar"});
    //     obj1.bindAttribute("name", "obj2.label");
    //     //Changes are now synced between obj1.name and obj2.label
    //     obj1.set({name: "Baz"});
    //     obj2.get("label"); //=> "Baz"
    bindAttribute: function(attr, toPath, toRoot) {
      new Backbone.Binding(attr, this, toPath, toRoot).connect();
    },

    boundAttributes: function() {
      var attrs = [];
      for(var prop in this) {
        if(prop.match(/Binding$/) || (this[prop] instanceof Backbone.Binding)) {
          attrs.push(prop);
        }
      }

      return attrs;
    },

    connectAttributeBindings: function() {
      _(this.boundAttributes()).each(function(attr) {

        var binding = this[attr];
        var boundAttribute = attr;
        var matches = attr.match(/^(.*?)Binding$/);
        if(matches) {
          binding = Backbone.Binding.to(this[attr]);
          boundAttribute = matches[1];
        }

        binding.from(boundAttribute, this).connect();
      }, this);
    }

  };


  // ## ComputedAttributes
  // Adds support for computed properties to a class. Instances of the
  // class will fire `change` events on the computed property whenever
  // an underlying property changes. For collections, the special syntax
  // `@each` or `@each.someProperty` is supported. In this case, a `change`
  // event will be fired when an item is added to or removed from the
  // collection, or when `someProperty` changes on one of the instances
  // in the collection.
  //
  // *Note*: This mixin requires an object path mixin to be included.
  //
  // ### Example
  //
  //     User = Backbone.Model
  //     .extend(Ribs.Mixins.ModelObjectPaths)
  //     .extend(Backbone.Mixins.ComputedAttributes)
  //     .extend({
  //         fullName: function() {
  //           return this.get('firstName') + ' ' + this.get('lastName');
  //         }.property('firstName', 'lastName')
  //       }
  //     );
  //
  //     Tasks = Backbone.Collection
  //     .extend(Backbone.Mixins.CollectionObjectPaths)
  //     .extend(Backbone.Mixins.ComputedAttributes)
  //     .extend({
  //         remaining: function() {
  //           return this.models.select(function(task) {
  //             return !task.get('isDone');
  //           }).length
  //         }.property('@each.isDone');
  //       }
  //     );
  //
  // See also `Backbone.Mixins.FunctionExtensions`, [Backbone.Events](http://documentcloud.github.com/backbone/#Events)
  // and [Sproutcore binding](http://edgedocs.sproutcore.com/symbols/Function.html#property)
  Backbone.Mixins.ComputedAttributes = {
    afterExtend: function(klass) {
      //Extend Function with stuff we need
      _(Function.prototype).extend(klass.prototype.FunctionExtensions);

      klass.prototype.initialize = _.wrap(klass.prototype.initialize, klass.prototype.initializeWithComputedAttributes);
      klass.prototype.get = _.wrap(klass.prototype.get, klass.prototype.getWithComputedAttributes);
      klass.prototype.previousAttributes = _.wrap(klass.prototype.previousAttributes, klass.prototype.previousAttributesWithComputedAttributes);
      klass.prototype.previous = _.wrap(klass.prototype.previous, klass.prototype.previousWithComputedAttributes);

    },

    initializeWithComputedAttributes: function(func, attributes) {
      func.call(this, attributes);
      _(this.computedAttributes()).each(function(attr) {
        this[attr]._bindDependencies(this, attr);
      }, this);
    },

    getWithComputedAttributes: function(func, attr) {
      var val = func.call(this, attr);
      if(val) { return val; }
      if(_.isFunction(this[attr]) && this[attr]._isComputedProperty) {
        if (this[attr]._cacheable) {
          if(!this.cachedComputedAttributes) { this.cachedComputedAttributes = {}; }

          if (_.isUndefined(this.cachedComputedAttributes[attr])) {
            return (this.cachedComputedAttributes[attr] = this[attr]());
          } else {
            return this.cachedComputedAttributes[attr];
          }
        } else {
          return this[attr]();
        }
      } else {
        return val;
      }
    },

    previousAttributesWithComputedAttributes: function(func) {
      var previousAttrs = func.call(this);
      return _(previousAttrs).extend(_.clone(this._previousComputedAttributes));
    },

    previousWithComputedAttributes: function(func, attr) {
      var previous;
      if (attr && this._previousComputedAttributes) {
        return this._previousComputedAttributes[attr];
      } else {
        return func.call(this, attr);
      }
    },

    computedAttributes: function() {
      var attrs = [];
      for(var prop in this) {
        if(_.isFunction(this[prop]) && this[prop]._isComputedProperty) {
          attrs.push(prop);
        }
      }
      return attrs;
    },

    attributesDependentOn: function(attribute) {
      var self = this;
      return this.computedAttributes().select(function(attr) {
        return _(self[attr]._dependencies).contains(attribute);
      });
    },

  // ## FunctionExtensions
  // Extends Functions with some utility functions that are used in
  // `Backbone.ComputedAttributes` to provide computed properties.
  //
  // The `property` function decorates a Function in a couple of ways:
  //  * it sets a flag on the function to indicate that it is a computed property.
  //  * the arguments passed to the this function are a list of attributes that this
  //    computed property depends on.
  //
  //  See `Backbone.Mixins.ComputedAttributes` for usage examples.
  //
    FunctionExtensions: {
      property: function() {
        var self = this;
        self._dependencies = Array.prototype.slice.call(arguments);

        self._triggerDependentEvent = function(obj, property, target, options) {
          var oldVal = (function() {
            if(obj.cachedComputedAttributes &&
               !_.isUndefined(obj.cachedComputedAttributes.property)) {
              return obj.cachedComputedAttributes.property;
            }

            var attrs = target.attributes;
            target.attributes = target._previousAttributes;
            var previousVal = target[property].call(target, {dryRun: true});
            target.attributes = attrs;
            return previousVal;
          }());

          obj._previousComputedAttributes = obj._previousComputedAttributes || {};
          obj._previousComputedAttributes[property] = oldVal;

          if (obj.cachedComputedAttributes) {
            obj.cachedComputedAttributes[property] = undefined;
          }

          var newVal = (function() {
            if(self._cacheable) {
              if(!obj.cachedComputedAttributes) { obj.cachedComputedAttributes = {}; }

              return (obj.cachedComputedAttributes[property] = target[property].call(target));
            } else {
              return target[property].call(target);
            }
          }());

          obj.trigger("change:" + property,
                      target,
                      newVal,
                      options);

        };

        self._bindCollectionDependency = function(dep, obj, property) {
          var key = dep.split(".")[1];
          if(key) {
            obj.bind("change:" + key, function(target, val, options) {
              self._triggerDependentEvent(obj,
                                          property,
                                          target,
                                          options);

            });
          } else {
            obj.bind("change", function(target, options) {
              self._triggerDependentEvent(obj,
                                          property,
                                          target,
                                          options);

            });
          }

          obj.bindMultiple(["add", "remove"], function(val, target, options) {
            self._triggerDependentEvent(obj,
                                        property,
                                        target,
                                        options);
          });

          obj.bind("refresh", function(target, options) {
            self._triggerDependentEvent(obj,
                                        property,
                                        target,
                                        options);

          });

        };

        self._bindDependency = function(dep, obj, property) {
          obj.bind("change:" + dep, function(target, val, options) {
            self._triggerDependentEvent(obj,
                                        property,
                                        target,
                                        options);

          });
        };

        self._bindDependencies = function(obj, property) {
          _(self._dependencies).each(function(dep) {
            if(dep.match(/^@each/)) {
              self._bindCollectionDependency(dep, obj, property);
            } else {
              self._bindDependency(dep, obj, property);
            }
          });
        };

        self._cacheable = false;

        self.cacheable = function() {
          self._cacheable = true;
          return self;
        };

        self._isComputedProperty = true;

        return self;
      }

    }
  };

  _(Backbone.Mixins.ComputedAttributes).extend(Backbone.Mixins.Event);

  Backbone.Mixins.Controller = {};

  // ## Controller.Filters
  // Adds support for before filters to objects.
  // ### Example:
  //
  //     var SomeController = window.BaseController.extend({
  //       beforeFilters: {"foo": ["show"]},
  //       foo: function() { console.log("foo"); },
  //       show: function() { console.log("show"); }
  //     });
  //
  //     var c = new SomeController;
  // To prevent the action from running, return false explicitly in your filter method.
  // I.e, `undefined` won't do.
  //
  //     c.show(); //Prints foo, followed by show
  //       var SomeController = window.BaseController.extend({
  //       beforeFilters: {"foo": ["show"]},
  //       foo: function() { console.log("foo"); return false; },
  //       show: function() { console.log("show"); }
  //     });
  //
  //     var c = new SomeController;
  //     c.show(); //Prints foo
  Backbone.Mixins.Controller.Filters = {
    afterExtend: function(klass) {
      klass.prototype.initialize = _.wrap(klass.prototype.initialize, function(func, options) {
        func.call(this, options);
        var filters = null;

        if(!this.beforeFilters) {
          return;
        }
        _(this.beforeFilters).each(function(actions, filter) {
          _(actions).each(function(action) {
            if(_.isFunction(this[action])) {
              this[action] = _.wrap(this[action], function(func, args) {
                if(this[filter].call(this) !== false) {
                  func.call(this, args);
                }
              });
            }
          }, this);
        }, this);
      });
    }
  };

  Backbone.Mixins.DEFAULT_MODEL_MIXINS = [
    Ribs.Mixins.ObjectPaths,
    Backbone.Mixins.Event,
    Backbone.Mixins.ComputedAttributes
  ];

  Backbone.Mixins.chainMixins = function(klass, mixins) {
    return _(mixins).inject(function(acc, cur) {
      return acc.extend(cur);
    }, klass);
  };

}());

/*globals _, Backbone*/
(function(exports) {
  var Ribs = exports.Ribs = exports.Ribs || {};
  Ribs.Mixins = Ribs.Mixins || {};
  Ribs.Mixins.Model = Ribs.Mixins.Model || {};

  // ## Ribs.Mixins.Model.Schema
  // Adds support for describing types of attributes
  // ### Example:
  //        Klass = Ribs.Model.extend({
  //        schema: {
  //          date: 'Date',
  //          flag: 'Boolean',
  //          id: 'Integer',
  //          revenue: 'Float'
  //        }
  //      });
  //
  //      var a = new Klass({
  //        date: '12/01/2011',
  //        flag: 'true',
  //        id: '123',
  //        revenue: '12.12'
  //      });
  //
  // In ``a``, the attributes ``date``, ``flag``, ``id`` and ``revenue`` will
  // be returned as objects of the mentioned types, when you fetch them via
  // ``get``.
  Ribs.Mixins.Model.Schema = {
    afterExtend: function(klass) {
      if(_.isFunction(klass.prototype.set)) {
        klass.prototype.set = _.wrap(klass.prototype.set,
                                     klass.prototype.setWithSchema);
      }
    },

    setWithSchema: function(func, attrs, options) {
      if(!this.schema) {
        return func.call(this, attrs, options);
      }

      var typedAttrs = {};
      _(attrs).each(function(val, key) {
        if(!this.schema[key] || this._isType(this.schema[key], val)) {
          typedAttrs[key] = val;
        } else {
          typedAttrs[key] = this._deserializeValue(this.schema[key], val);
        }
      }, this);

      return func.call(this, typedAttrs, options);
    },

    _deserializeValue: function(type, untypedVal) {
      if(_.isNull(untypedVal)) { return null; }

      switch (type) {
      case 'Date':
        return new Date(untypedVal);
      case 'Boolean':
        return (untypedVal === "true") ? true : false;
      case 'Number':
        return parseFloat(untypedVal, 10);
      default:
        var actualType = this._modelType(type);
        if(actualType) {
          return new actualType(untypedVal);
        } else {
          throw "Unknown type to deserialize: " + type;
        }
      }

      return untypedVal;
    },

    _isType: function(type, val) {
      var checker = _['is' + type];

      if(checker) {
        return checker.call(_, val);
      } else {
        return false;
      }
    },

    _modelType: function(type) {
      return Backbone.Binding.objectAtPath(type);
    }

  };

}(this));

/*globals _*/
(function(exports) {
  var Ribs = exports.Ribs = exports.Ribs || {};
  Ribs.Mixins = Ribs.Mixins || {};
  Ribs.Mixins.Model = Ribs.Mixins.Model || {};

  Ribs.Mixins.Model.IdentityMap = {
    createIdentityMapModel: function(model) {
      var identityMap = {};

      var identityMapModel = function(attributes, options) {
        model.apply(this, [attributes, options]);

        if (attributes && attributes[this.idAttribute]) {
          var idKey;
          if(this.name) {
            idKey = this.name + "/" + attributes[this.idAttribute];
          } else {
            idKey = this.url();
          }

          var cachedModel = identityMap[idKey];
          if (cachedModel) {
            var newAttributes = _.reduce(_.keys(attributes), function(memo, name) {
              if (!cachedModel.attributes.hasOwnProperty(name)) {
                memo[name] = attributes[name];
              }
              return memo;
            }, {});

            cachedModel.set(newAttributes);

            return cachedModel;
          } else {
            identityMap[idKey] = this;
          }
        }
      };

      _.extend(identityMapModel, model);
      identityMapModel.prototype = new model();

      return identityMapModel;
    }
  };

}(this));

/*globals _, $*/
(function(exports) {
  var Ribs = exports.Ribs = exports.Ribs || {};
  Ribs.Mixins = Ribs.Mixins || {};

  Ribs.Mixins.AutoFetch = {
    afterExtend: function(klass) {
      klass.prototype.fetch = _.wrap(klass.prototype.fetch, klass.prototype.fetchWithStatus);

      // this is a hack that makes sure that we only do this on Backbone.Model and not Backbone.Collection
      if (_.isFunction(klass.prototype.set)) {
        klass.prototype.get = _.wrap(klass.prototype.get, klass.prototype.getWithAutoFetch);
      }
    },

    fetchWithStatus: function(func, options) {
      options = options || {};
      var self = this;

      if (options.reload || !this.deferedFetch) {
        this.fetching = true;
        this.trigger('fetch', this);
        this.deferedFetch = $.Deferred(function(deferred_obj) {
          func.call(self, {
            success: deferred_obj.resolve,
            error: deferred_obj.reject
          });
        }).promise();

        this.deferedFetch.always(function() {
          self.fetching = false;
          self.trigger('fetch', self);
        });
      }

      this.deferedFetch.done(options.success);
      this.deferedFetch.fail(options.error);

      return this;
    },

    getWithAutoFetch: function(func, attr) {
      var value = func.call(this, attr);

      if (value === undefined && this.id && !this.collection) {
        this.fetch();
      }

      return value;
    }
  };

}(this));

/*globals Backbone, Handlebars, _, $, Ribs*/
(function(exports) {
  var Ribs = exports.Ribs || {};
  exports.Ribs = Ribs;

  // Adds support in handlebars to use model.get('name') for attribute lookup
  // when the context is an instance of `Backbone.Model`.
  var defaultNameLookup = Handlebars.JavaScriptCompiler.prototype.nameLookup;
  Handlebars.JavaScriptCompiler.prototype.nameLookup = function(parent, name, type) {
    if (type === 'context') {
      return "(Backbone.Binding.objectAtPath('" + name + "', " + parent +") || null)";
    } else {
      return defaultNameLookup(parent, name, type);
    }
  };

  Ribs.compileTemplate = function(string) {
    return Handlebars.compile(string, {data: true});
  };

  // ## Handlebars Helpers

  // Defines the `#view` handlebars block helper. Using the `#view` helper will instantiate a
  // backbone view class to manage bindings between the handlebars block and a backbone model.
  //
  //     {{#view}}
  //       <a href="#users/{{id}}">{{name}}</a>
  //     {{/view}}
  //
  // Given the context of a user will create a binding that updates the link to the user every
  // time the user triggers a `change` event.
  //
  //     {{#view "MyUserView"}}
  //       <a href="#users/{{id}}">{{name}}</a>
  //     {{/view}}
  //
  // Will use the `MyUserView` view class to handle the handlebars block, assuming that `MyUserView`
  // is extends `Ribs.TemplateView`. No bindings will be setup automatically, but any custom
  // binding can be setup in `MyUserView`
  //
  //     {{#view binding="user"}}
  //       <a href="#users/{{user.id}}">{{user.name}}</a>
  //     {{/view}}
  //
  // Given a context that includes a user object create a binding that updates the link to the user every
  // time the user triggers a `change` event.
  //
  //     {{#view tagName="div" classBinding="user.isAdmin"}}
  //       <a href="#users/{{user.id}}">{{user.name}}</a>
  //     {{/view}}
  //
  // Will wrap the template in a div tag with a class of "isAdmin" if the user is an admin and no class if
  // the user is not an admin.
  Handlebars.registerHelper('view', function(viewClassNameOrBlock, block) {
    var viewConstructor;
    var template;

    if (_.isFunction(viewClassNameOrBlock)) {
      viewConstructor = Ribs.TemplateView;
      template = viewClassNameOrBlock;
    } else {
      viewConstructor = Backbone.Binding.objectAtPath(viewClassNameOrBlock);
      template = block;
    }

    var binding;

    if (template.hash.binding) {
      binding = template.hash.binding;
    } else if (viewConstructor == Ribs.TemplateView) {
      binding = this;
    }

    var options = _.extend(template.hash, {
      context:    this,
      template:   template,
      parentView: (template.data || {}).view
    });

    if (_.isString(binding)) {
      var self = this;
      options.cleanup = function() {
        viewConstructor.prototype.cleanup.call(this);
        self.unbindChangeOnPath(binding, this.update);
      };
    } else if (binding) {
      options.cleanup = function() {
        viewConstructor.prototype.cleanup.call(this);
        binding.unbind('change', this.update);
      };
    }

    var view = new viewConstructor(options);

    if (_.isString(binding)) {
      this.bindChangeOnPath(binding, view.update);
    } else if (binding) {
      binding.bind('change', view.update);
    }

    return new Handlebars.SafeString(view.renderToString());
  });

  // Defines the `#collection` handlebars block helper. Using the `#collection` helper will instantiate
  // a `Ribs.CollectionTemplateView` that manages all the events triggered by the collection
  // when items are added or removed, and when the the collection refreshes. For each item in the
  // collection, a backbone view will be instantiated to handle events for that item.
  //
  //     <ul>
  //     {{#collection users}}
  //       <a href="#users/{{id}}">{{name}}</a>
  //     {{/view}}
  //     </ul>
  //
  // Given a context with a users collection, it will generate a `ul` element with an `li` element for
  // each user. Each `li` element will have a link to the user. When items are added or removed, the
  // DOM will automatically be updated. Each `li` will also automatically update when ever the given
  // user triggers a `change` event.
  //
  //     {{#collection users itemTagName="div"}}
  //       <a href="#users/{{id}}">{{name}}</a>
  //     {{/view}}
  //
  // This works just like the previous example, but will generate `div` elements around each item
  // instead of `li` elements.
  //
  //     <ul>
  //     {{#collection users itemView="MyUserView"}}
  //       <a href="#users/{{id}}">{{name}}</a>
  //     {{/collection}}
  //     </ul>
  //
  // In this example, we use `MyUserView` to manage the bindings for each item. No bindings
  // will be added automatically, but bindings can be registered in `MyUserView`.
  Handlebars.registerHelper('collection', function(collection, block) {
    var itemView;
    if (block.hash.itemView) {
      itemView = Backbone.Binding.objectAtPath(block.hash.itemView);
    } else {
      itemView = Ribs.TemplateView;
    }

    var options = _.extend(block.hash, {
      itemView: itemView,
      collection: collection,
      parentView: (block.data || {}).view,
      context: this,
      template: block,
      bindToItemChange: itemView === Ribs.TemplateView
    });

    var collectionView = new Ribs.CollectionTemplateView(options);

    return collectionView.renderToString();
  });

  Handlebars.registerHelper('bind', function(path, block) {
    var context = this;

    var options = _.extend(block.hash, {
      context: context,
      parentView: (block.data || {}).view,
      template: function() {
        return context.get(path);
      },
      cleanup: function() {
        Ribs.TemplateView.prototype.cleanup.call(this);
        context.unbindChangeOnPath(path, this.update);
      }
    });
    options.tagName = options.tagName || 'span';

    var view = new Ribs.TemplateView(options);

    this.bindChangeOnPath(path, view.update);

    return new Handlebars.SafeString(view.renderToString());
  });

  var originalEachHelper = Handlebars.helpers.each;
  Handlebars.registerHelper('each', function(context, fn, inverse) {
    if (context instanceof Backbone.Collection) {
      return originalEachHelper(context.models, fn, inverse);
    } else {
      return originalEachHelper(context, fn, inverse);
    }
  });


  // ## Ribs Template Views

  // Defines a template-based `Backbone.View`. You have to pass a `template` which must be a function that,
  // given a context, renders and returns a string of markup. In addition to the `template`, you must also
  // provide a `context` used for rendering.
  //
  //     var HelloView = Ribs.TemplateView.extend({
  //       el: "#content",
  //       template: function(context) { return "<h1>Hello {{name}}!</h1>"; },
  //       context: {name: 'World'}
  //     });
  //
  // A stupid example that always just renders `<h1>Hello World</h1>` into the element with the id `content`.
  //
  // You can store named templates in the `Ribs.TemplateView.templates` object and just refer to the name
  // in your view. So the example above would be:
  //
  //     Ribs.TemplateView.templates['hello'] = function(context) {
  //       return "<h1>Hello {{name}}!</h1>";
  //     };
  //
  //     var HelloView = Ribs.TemplateView.extend({
  //       el: "#content",
  //       template: 'hello',
  //       context: {name: 'Mick'}
  //     });
  //
  // Just like plain `Backbone.View`, you should specify the `el` and `tagName`.
  Ribs.TemplateView = Backbone.View.extend({
    initialize : function(options) {
      options = options || {};

      this.context      = options.context || this.context;
      this.tagName      = options.tagName || this.tagName;
      this.template     = options.template || this.template;
      this.template     = _.isFunction(this.template) ? this.template : Ribs.TemplateView.templates[this.template];
      this.cleanup      = _.bind(options.cleanup || this.cleanup, this);
      this.beforeRender = _.bind(options.beforeRender || this.beforeRender, this);
      this.afterRender  = _.bind(options.afterRender || this.afterRender, this);
      this.events       = options.events || this.events || {};
      this.classBinding = options.classBinding || this.classBinding;
      this.tagAttributes = options.tagAttributes || this.tagAttributes || {};
      this.childViews   = this.childViews || [];

      this.prepareForBinding(options);
    },

    _ensureElement: function() {},

    cleanup: function() {},

    cleanupChildren: function() {
      _.each(this.childViews || [], function(child) {
        child.cleanupChildren();
        child.cleanup();
      });

      this.childViews = [];
    },

    addChild: function(child) {
      this.childViews.push(child);
    },

    prepareForBinding: function(options) {
      this.update           = _.bind(this.update, this);
      this.render           = _.bind(this.render, this);
      this.renderToString   = _.bind(this.renderToString, this);
      this.addChild         = _.bind(this.addChild, this);

      this.parentView     = options.parentView || this.parentView;
      this.rootView       = this.parentView ? this.parentView.rootView : this;
      if (this.parentView) {
        this.parentView.addChild(this);
      }

      // classes to be added on initial render due to classBinding:
      this.initiallyBoundClasses     = [];

      if (!this.el) {
        this.id = this.id || this.cid;
        this.el = '#' + this.id;
      }

      var self = this;

      if (this.classBinding) {
        // for each "object.subobject.property"...
        _(this.classBinding.split(/\s*,\s*/)).each(function(binding) {
          // the class name is the property
          var boundClassName = _(binding.split('.')).last();
          // add the class for first render if the property is truthy
          var value = self.context.get(binding);
          if (self.context.get(binding)) {
            self.initiallyBoundClasses.push(boundClassName);
          } else {
            self.initiallyBoundClasses.push('not_' + boundClassName);
          }
          // and add a binding to toggle the class in the future
          self.context.bindChangeOnPath(binding, function() {
            var value = self.context.get(binding);
            $(self.el).toggleClass(boundClassName, value);
            $(self.el).toggleClass('not_' + boundClassName, !value);
          });
        });
      }
    },

    classNames: function() {
      return _.compact(_.flatten([this.className, this.initiallyBoundClasses]));
    },

    renderToString: function() {
      var content = [];
      content.push("<" + this.tagName + ' id="' + this.id + '"');

      var classNames = this.classNames();
      if (_.any(classNames)) {
        content.push(' class="' + classNames.join(' ') + '"');
      }

      _(this.tagAttributes).each(function(value, key) {
        content.push(' ' + key + '="' + (value || '') + '"');
      });

      var innerContent = this.render();

      if (innerContent) {
        content.push('>' + innerContent + '</' + this.tagName + '>');
      } else {
        content.push(' />');
      }

      return content.join('');
    },

    beforeRender: function() {
      this.cleanupChildren();
    },

    afterRender: function() {
      if (_.any(this.events)) {
        this.delegateEvents(this.events);
      }

      _.each(this.childViews || [], function(child) {
        child.afterRender();
      });
    },

    render: function() {
      var content = this.template(this.context, null, null, {view: this, parentView: this.parentView});

      $(this.el).html(content);

      return content;
    },

    update: function() {
      this.beforeRender();

      var content = this.render();

      this.afterRender();

      return content;
    }
  });

  Ribs.TemplateView.templates = {};

  // `Ribs.CollectionTemplateView` is a `Ribs.TemplateView` that expects the context to be a `Backbone.Collection`.
  // It will then manage a list of `Ribs.TemplateView`s that each get passed an item from the collection as their context.
  //
  //     var users = new UserCollection();
  //
  //     var UserView = Ribs.TemplateView.extend();
  //
  //     var UserListView = Ribs.CollectionTemplateView.extend({
  //       el: "#user_list",
  //       template: 'user_list_item',
  //       itemView: UserView,
  //       context: users
  //     });
  //
  // This is going to render the user_list_item template once per user in the collection,
  // and will automatically add and remove items when the collection changes.
  Ribs.CollectionTemplateView = Ribs.TemplateView.extend({
    initialize: function(options) {
      options = options || {};

      this.collection = options.collection || this.collection;

      if (this.collection) {
        if (!(this.collection instanceof Backbone.Collection)) {
          throw new Error("HandlebarsCollectionView must be passed a Backbone.Collection");
        }

        Ribs.TemplateView.prototype.initialize.call(this, options);

        this.addModel    = _.bind(this.addModel, this);
        this.removeModel = _.bind(this.removeModel, this);

        this.itemName         = options.itemName || this.itemName || 'item';
        this.itemView         = options.itemView || this.itemView;
        this.itemTagName      = options.itemTagName || this.itemTagName || 'li';
        this.itemClassName    = options.itemClassName || this.itemClassName;
        this.itemClassBinding = options.itemClassBinding || this.itemClassBinding;
        this.bindToItemChange = options.bindToItemChange;

        this.collection.bind('refresh', this.update);
        this.collection.bind('add',     this.addModel);
        this.collection.bind('remove',  this.removeModel);
      }
    },

    cleanup: function() {
      Ribs.TemplateView.prototype.cleanup.call(this);

      if (this.collection) {
        this.collection.unbind('refresh', this.update);
        this.collection.unbind('add',     this.addModel);
        this.collection.unbind('remove',  this.removeModel);
        this.collection.unbind('fetch',   this.update);
      }
    },

    _newItemView: function(model) {
      var itemContext = new Ribs.Object({parent: this.context, collection: this.collection});
      var extraContext = {};
      extraContext[this.itemName] = model;
      itemContext.set(extraContext);

      var self = this;

      var newItemView = new (this.itemView)({
        parentView: this,
        context: itemContext,
        template: this.template,
        tagName: this.itemTagName,
        className: this.itemClassName,
        classBinding: this.itemClassBinding,
        tagAttributes: {'data-id': model.id, 'data-cid': model.cid},
        cleanup: function() {
          self.itemView.prototype.cleanup.call(this);
          model.unbind('change', this.update);
        }
      });

      if (newItemView && newItemView.update && this.bindToItemChange) {
        model.bind('change', newItemView.update);
      }

      return newItemView;
    },

    classNames: function() {
      var classNames = Ribs.TemplateView.prototype.classNames.call(this);
      if (!this.collection || this.collection.fetching !== false) {
        classNames.push('loading');
      }
      return classNames;
    },

    render: function() {
      if (!this.collection) {
        return '';
      }

      if (this.collection.model.length === 0 && !this.collection.fetching) {
        this.collection.fetch();
        this.collection.bind('fetch', this.update);
      }

      var itemView;
      var content = this.collection.map(function(model) {
        itemView = this._newItemView(model);
        if (itemView && itemView.renderToString) {
          return itemView.renderToString();
        } else {
          return '';
        }
      }, this).join('');

      $(this.el).html(content);
      $(this.el).toggleClass('loading', !this.collection.fetching);

      return content;
    },

    addModel: function(model) {
      var view = this._newItemView(model);
      $(this.el).append(view.renderToString());
      view.afterRender();
    },

    removeModel: function(model) {
      $('[data-cid=' + model.cid + ']').unbind().remove();
    }
  });
}(this));

/*globals Backbone, _*/
(function(defaultRoot) {

  // Sets up a two-way link between two objects described by `fromPath` and
  // `toPath`. Both paths are expected to be in the dot-notation, and are resolved
  // in the context of the optional arguments `fromRoot` and `toRoot` respectively,
  // each defaulting to the `window` object.
  Backbone.Binding = function(fromPath, fromRoot, toPath, toRoot){
    this.from(fromPath, fromRoot);
    this.to(toPath, toRoot);
  };

  // Set up half a binding, to an object at the specified path, `toPath`. Returns
  // a partially constructed `Backbone.Binding` object that can be linked up later
  // by calling the `from` method on it.
  Backbone.Binding.to = function(toPath, toRoot) {
    return new Backbone.Binding(null, null, toPath, toRoot);
  };

  // Utility function to split an object path into two parts:
  //
  // * the unqualified name of the object in question (the last part of the path)
  // * the namespace of that object (the rest of the path)
  Backbone.Binding.splitPath = function(path) {
    var parts = path.split(".");
    return [parts.slice(0, parts.length-1).join("."), parts.slice(-1)[0]];
  };

  // Resolves the provided `path` in the context of the optional `root` object,
  // calling the `callback` function at each level, if provided. This method is
  // aware of computed attributes (See `Backbone.Mixin.ComputedAttributes`), and
  // will descend into them as needed.
  Backbone.Binding.objectAtPath = function(path, root, callback) {
    if(!root) {
      root = defaultRoot;
    }

    var obj = root, nextObj = null;

    if(callback) {
      callback(root);
    }

    _(path.split(".")).each(function(part) {

      if(!obj) {
        return;
      }

      if(obj.get) {
        nextObj = obj.get(part);
      } else {
        nextObj = obj[part];
      }
      if(_.isFunction(nextObj) && nextObj.isComputedProperty && nextObj.isComputedProperty()) {
        nextObj = nextObj.call(obj);
      }

      if(callback) {
        callback(nextObj);
      }

      obj = nextObj;
    }, this);

    return obj;
  };

  // Resolves the provided path using `Backbone.Binding.objectAtPath`, and returns
  // an array with the objects at each level of the path.
  Backbone.Binding.objectsAtPath = function(path, root) {
    var objects = [];
    Backbone.Binding.objectAtPath(path, root, function(obj) {
      objects.push(obj);
    });
    return objects;
  };

  Backbone.Binding.prototype = {
    // Creates a `from` link on the calling `Backbone.Binding` object. Used to
    // complete a partial link created using `Backbone.Binding.to` or the instance
    // method `to`.
    from: function(fromPath, fromRoot) {
      if(fromPath || fromRoot) {
        var paths = Backbone.Binding.splitPath(fromPath);
        if(paths[0]) {
          this.fromObject = Backbone.Binding.objectAtPath(paths[0], fromRoot);
        } else {
          this.fromObject = fromRoot;
        }
        this.fromKey = paths[1];
      }
      return this;
    },

    // Creates a `to` link on the calling `Backbone.Binding` object. Used to
    // complete a partial link created using the instance method `from`.
    to: function(toPath, toRoot) {
      if(toPath || toRoot) {
        var paths = Backbone.Binding.splitPath(toPath);
        if(paths[0]) {
          this.toObject = Backbone.Binding.objectAtPath(paths[0], toRoot);
        } else {
          this.toObject = toRoot;
        }
        this.toKey = paths[1];
      }
      return this;
    },

    // Actually establish the link. Sets up the event handlers that are responsible
    // for two-way propagation of changes.
    connect: function() {
      var param = {};

      if(!this.fromObject || !this.toObject) {
        throw new Error("Binding needs both 'from' and 'to' to be set!");
      }

      this.fromObject.bind("change:" + this.fromKey, _(function(obj) {
        param = {};
        param[this.toKey] = obj.get(this.fromKey);
        this.toObject.set(param, {silent: true});
      }).bind(this));

      this.toObject.bind("change:" + this.toKey, _(function(obj) {
        param = {};
        param[this.fromKey] = obj.get(this.toKey);
        this.fromObject.set(param, {silent: true});
      }).bind(this));
    }
  };

}(this));

/*globals Backbone, _*/
(function(exports) {
  var Ribs = exports.Ribs || {};
  exports.Ribs = Ribs;

  // A subset of Backbone.Model with no notion of a data store. Use this is you need
  // an object that needs to have attributes and events, but is not necessarily backed
  // by a data store. Also comes with several `Backbone.Mixins` out of the box:
  //
  //  * `Ribs.Mixins.ExtendExtensions`
  //  * `Ribs.Mixins.ObjectPaths`
  //  * `Backbone.Mixins.ComputedAttributes`
  //  * `Backbone.Mixins.Event`
  Ribs.Object = function(attributes, options) {
    attributes = attributes || {};
    if (this.defaults) { attributes = _.extend({}, this.defaults, attributes); }
    this.attributes = {};
    this._escapedAttributes = {};
    this.cid = _.uniqueId('c');
    this.set(attributes, {silent : true});
    this._previousAttributes = _.clone(this.attributes);
    if (options && options.collection) { this.collection = options.collection; }
    this.initialize(attributes, options);
  };

  Ribs.Object.prototype = {
    initialize: function(){}
  };

  _(["get", "set", "change", "unset",
     "clear", "clone", "hasChanged",
     "changedAttributes", "previous",
     "previousAttributes", "escape"]).each(function(meth) {
       Ribs.Object.prototype[meth] = Backbone.Model.prototype[meth];
     });

  _.extend(Ribs.Object.prototype, Backbone.Events);
  Ribs.Object.extend = Backbone.Model.extend;

  Ribs.Object = Backbone.Mixins.chainMixins(Ribs.Object, Backbone.Mixins.DEFAULT_MODEL_MIXINS);

}(this));
/*globals Backbone, _*/
(function() {

  // Helper function that move from `from` to `to`.
  // Sets the `isInFocus` on `from` and `to` appropriately and returns `to`.
  function move(from, to) {
    if (to && from !== to) {
      if (from) { from.set({ isInFocus: false }); }
      to.set({ isInFocus: true });
    }
    return to || null;
  }

  // Helper function to find the element adjacent to an element.
  // Returns the element before (if `direction` is -1) or after
  // (if `direction` is +1) `from` in `collection`. If the adjacent
  // element would be off either end of the collection, returns `from` itself.
  function findAdjacent(collection, from, direction) {
    var index = collection.indexOf(from);
    if (index >= 0) {
      if (index + direction >= 0 && index + direction < collection.length) {
        return collection.at(index + direction);
      } else {
        // off the end of the collection
        return from;
      }
    } else {
      return null;
    }
  }

  // Helper function that implements the logic of
  // `Backbone.Mixins.CollectionNavigation` (see below).
  function addNavigationSupport(collection) {
    var elementInFocus = null;

    collection.elementInFocus = function() {
      return elementInFocus;
    };

    collection.focusOn = function(element) {
      if (collection.indexOf(element) >= 0) {
        elementInFocus = move(elementInFocus, element);
      }
    };

    collection.bind('navigation-first', function moveToFirst() {
      elementInFocus = move(elementInFocus, collection.first());
    });

    collection.bind('navigation-previous', function moveToPrevious() {
      if (elementInFocus) {
        elementInFocus = move(elementInFocus, findAdjacent(collection, elementInFocus, -1));
      } else {
        elementInFocus = move(elementInFocus, collection.last());
      }
    });

    collection.bind('navigation-next', function moveToNext() {
      if (elementInFocus) {
        elementInFocus = move(elementInFocus, findAdjacent(collection, elementInFocus, +1));
      } else {
        elementInFocus = move(elementInFocus, collection.first());
      }
    });

    collection.bind('navigation-last', function moveToLast() {
      elementInFocus = move(elementInFocus, collection.last());
    });

    collection.bind('remove', function(removed, collection) {
      if (elementInFocus === removed) {
        elementInFocus = null;
      }
    });
  }

  // ## `Backbone.Mixins.CollectionNavigation`
  // `CollectionNavigation` is a mixin for `Backbone.Collection` that
  // binds to various navigation events and changes the "focused" element
  // in the collection. It's great for keyboard navigation in a list.
  //
  // By default, no item in the collection will be focused on initially.
  // A "next" event from this state will focus on the first element in
  // the collection. A "previous" event will focus on the last element
  // in the collection.
  //
  // ### Events
  //  * `navigation-first`
  //  * `navigation-previous`
  //  * `navigation-next`
  //  * `navigation-last`
  //
  // ### Using the focused element
  //
  // The first way to determine the currently-focused element in the
  // collection is to ask the collection for `.elementInFocus()`. This
  // will return a member of the collection, or `null` if no element
  // is in-focus.
  //
  // The second way is to listen for elements' `change:isInFocus` events.
  // `CollectionNavigation` will set and unset the `isInFocus` property on
  // elements as it changes the focus.
  //
  // ### Setting the focused element directly
  //
  // In addition to event-based movement, a `Collection` with
  // `CollectionNavigation` supports the `#focusOn` method:
  //
  //     collection.focusOn(collection.first());
  function CollectionNavigation() {
    var parent = this;
    return {
      initialize: function() {
        parent.prototype.initialize.apply(this, arguments);
        addNavigationSupport(this);
      }
    };
  }

  Backbone.Mixins.CollectionNavigation = CollectionNavigation;

}());

/*globals Backbone, _, Ribs*/
(function() {

  // ## Global Event handling
  // For events that do not originate from a particular DOM element --
  // for exmaple, keyboard shortcuts (which must be bound at the
  // `document.body` level) or events triggered by widgets or plugins --
  // `Backbone.GlobalEvents` serves as a focal point.
  var GlobalEvents = new Ribs.Object({

    // ### First Responder
    // When `Backbone.GlobalEvents` receives an event, it re-triggers the
    // event on `firstResponder`.
    // Any model, view, or controller (indeed, anything that includes
    // `Backbone.Events`) can be set as `firstResponder`. Generally,
    // a view will be set at the first responder, indicating that it
    // is the "in-focus" DOM element.
    firstResponder: null

  });

  // wrap .trigger: first re-trigger the event on firstResponder if it's set
  var originalTrigger = GlobalEvents.trigger;
  GlobalEvents.trigger = function() {
    var firstResponder = this.get('firstResponder');
    if (firstResponder) {
      firstResponder.trigger.apply(firstResponder, arguments);
    }
    // **TODO** we may want to allow the `firstResponder` to halt propagation
    // of the event on to the global handlers. As of now, there is no use
    // case for this.
    originalTrigger.apply(this, arguments);
  };

  // Export GlobalEvents
  Backbone.GlobalEvents = GlobalEvents;

  // ## `ResponderSupport`
  // A mixin that allows instances to be set as the frist responder.
  var ResponderSupport = {
    // ### `.focus`
    // Set this object as the first responder.
    // Returns `this` for chaining.
    focus: function() {
      Backbone.GlobalEvents.set({ firstResponder: this });
      return this;
    }
  };

  Backbone.Mixins.ResponderSupport = ResponderSupport;

  // ## ResponderView
  // A mixin for `Backbone.View`s that causes the view to add a `focusin`
  // handler when rendering that sets `Backbone.GlobalEvents.firstResponder`.
  var ResponderView = function() {
    var parentClass = this;
    return _.extend({
      render: _.wrap(this.prototype.render, function(superRender) {
        var result = superRender.apply(this, arguments);
        this.addFocusInHandlers();
        return result;
      }),

      // Adds the `focusin` handlers to elements in this view to set the view
      // as the `firstResponder`.
      addFocusInHandlers: function() {
        var view = this;
        this.$('> *').bind('focusin.firstResponder click.firstResponder', function() {
          view.focus();
        });
      }
    }, ResponderSupport);
  };

  // Export ResponderView
  Backbone.Mixins.ResponderView = ResponderView;

}());

/*globals Backbone, _*/
(function(exports) {
  var Ribs = exports.Ribs || {};
  exports.Ribs = Ribs;

  Ribs.Model = Backbone.Mixins.chainMixins(Backbone.Model.extend(Ribs.Mixins.Model.Schema), Backbone.Mixins.DEFAULT_MODEL_MIXINS)
    .extend(Ribs.Mixins.AutoFetch);

  Ribs.Model = Ribs.Mixins.Model.IdentityMap.createIdentityMapModel(Ribs.Model);

  Ribs.Collection = Backbone.Collection
    .extend(Backbone.Mixins.ComputedAttributes)
    .extend(Ribs.Mixins.ObjectPaths)
    .extend(Ribs.Mixins.AutoFetch)
    .extend(Backbone.Mixins.CollectionNavigation);

  Ribs.Controller = Backbone.Controller
    .extend(Backbone.Mixins.Controller.Filters)
    .extend({
      afterExtend: function(klass) {
        klass.prototype.initialize = _.wrap(klass.prototype.initialize, klass.prototype.initializeWithContext);
      },
      initializeWithContext: function(func, options) {
        func.call(this, options);
        this.context = this.context || new Ribs.Object();
        this.context.set({controller: this}, {silent: true});
      },
      redirect: function(hashLocation) {
        // TODO: do something smarter with pushstate eventually
        document.location.hash = hashLocation;
      }
    });

  Ribs.TemplateView = Ribs.TemplateView
    .extend(Backbone.Mixins.Event)
    .extend(Backbone.Mixins.ResponderView);

  /*
  var BarModel = Ribs.Model.extend({
    notDone: function() {
      return !this.get("isDone");
    }.property("isDone")
  });

  var BarsModel = Ribs.Collection.extend({
    allDone: function() {
      return ((this.length > 0) && this.every(function(obj) {
        return obj.get("isDone");
      }, this));
    }.property("@each.isDone")
  });

  Zendesk.BarModel = BarModel;
  Zendesk.BarsModel = BarsModel;
  */
}(this));
