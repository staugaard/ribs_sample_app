var TodoApp = {};

TodoApp.TodoItem = Ribs.Model.extend({
  urlRoot: '/todos',

  schema: {
    id:         'Number',
    title:      'String',
    createdAt:  'Date',
    isDone:     'Boolean'
  }
});

TodoApp.TodoList = Ribs.Collection.extend({
  url: '/todos',
  model: TodoApp.TodoItem
});

TodoApp.TodoController = Ribs.Controller.extend({
  routes: {
    '':       'index',
    '/todos': 'index'
  },
  initialize: function(options) {
    this.todos = new TodoApp.TodoList([
      new TodoApp.TodoItem({
        id: 1,
        title: 'test',
        createdAt: new Date(),
        isDone: false
      })
    ]);
    Ribs.Controller.prototype.initialize.call(this, options);
  },
  index: function() {
    this.context.set({todos: this.todos, name: 'Shopping'});
  }
});

TodoApp.TodoView = Ribs.TemplateView.extend({
  template: 'todos-template',
  el: '#todos',
  events: {
    'keyup input': 'onKeyup'
  },
  onKeyup: function(e) {
    if (e.keyCode === 13) {
      var item = new TodoApp.TodoItem({title: this.$('input').val()});
      this.context.get('todos').add(item);
      this.$('input').val('');
    }
  }
});

TodoApp.TodoItemView = Ribs.TemplateView.extend({
  events: {
    'click': 'toggle'
  },
  toggle: function() {
    var value = !this.context.get('todo.isDone');
    this.context.set({'todo.isDone': value});
  }
});

TodoApp.todoController = new TodoApp.TodoController();

$(function() {
  $('script[type="text/x-handlebars-template"]').each(function(index, item) {
    item = $(item);
    Ribs.TemplateView.templates[item.attr('id')] = Ribs.compileTemplate(item.html());
  });

  TodoApp.todoView = new TodoApp.TodoView({
    context: TodoApp.todoController.context
  });
  TodoApp.todoController.context.bind('change', TodoApp.todoView.update);

  Backbone.history.start();  
});
