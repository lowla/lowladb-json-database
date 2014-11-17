/*global jQuery, Handlebars */
jQuery(function ($) {
	'use strict';

	Handlebars.registerHelper('eq', function(a, b, options) {
		return a === b ? options.fn(this) : options.inverse(this);
	});

	var ENTER_KEY = 13;
	var ESCAPE_KEY = 27;

	var util = {
		uuid: function () {
			/*jshint bitwise:false */
			var i, random;
			var uuid = '';

			for (i = 0; i < 32; i++) {
				random = Math.random() * 16 | 0;
				if (i === 8 || i === 12 || i === 16 || i === 20) {
					uuid += '-';
				}
				uuid += (i === 12 ? 4 : (i === 16 ? (random & 3 | 8) : random)).toString(16);
			}

			return uuid;
		},
		pluralize: function (count, word) {
			return count === 1 ? word : word + 's';
		}
	};

	var App = {
		init: function () {
			var lowla = this.lowla = new LowlaDB({ datastore: 'Memory' });
      lowla.on('pullBegin', function() {
        console.log("Pull beginning");
      });
      lowla.on('pushBegin', function() {
        console.log("Push beginning");
      });

      lowla.on('pullEnd', function() {
        console.log("Pull ended");
      });
      lowla.on('pushEnd', function() {
        console.log("Push ended");
      });

      this.todos = lowla.collection('lowlaSample', 'todos');
      lowla.sync('http://localhost:3000', { pollFrequency: 500 });
      this.todos.find({}).sort('title').on(function(err, cursor) {
        this.render(cursor);
      }.bind(this));


			this.cacheElements();
			this.bindEvents();

			Router({
				'/:filter': function (filter) {
					this.filter = filter;
					this.render();
				}.bind(this)
			}).init('/all');
		},
		cacheElements: function () {
			this.todoTemplate = Handlebars.compile($('#todo-template').html());
			this.footerTemplate = Handlebars.compile($('#footer-template').html());
			this.$todoApp = $('#todoapp');
			this.$header = this.$todoApp.find('#header');
			this.$main = this.$todoApp.find('#main');
			this.$footer = this.$todoApp.find('#footer');
			this.$newTodo = this.$header.find('#new-todo');
			this.$toggleAll = this.$main.find('#toggle-all');
			this.$todoList = this.$main.find('#todo-list');
			this.$count = this.$footer.find('#todo-count');
			this.$clearBtn = this.$footer.find('#clear-completed');
		},
		bindEvents: function () {
			var list = this.$todoList;
			this.$newTodo.on('keyup', this.create.bind(this));
			this.$toggleAll.on('change', this.toggleAll.bind(this));
			this.$footer.on('click', '#clear-completed', this.destroyCompleted.bind(this));
			list.on('change', '.toggle', this.toggle.bind(this));
			list.on('dblclick', 'label', this.edit.bind(this));
			list.on('keyup', '.edit', this.editKeyup.bind(this));
			list.on('focusout', '.edit', this.update.bind(this));
			list.on('click', '.destroy', this.destroy.bind(this));
		},
		render: function (cursor) {
      var self = this;
      if (!cursor) {
        cursor = this.todos.find().sort('title');
      }
      cursor.showPending().toArray().then(function(todos) {
        self.$todoList.html(self.todoTemplate(todos));
        self.$main.toggle(todos.length > 0);
        self.$toggleAll.prop('checked', self.getActiveTodos().length === 0);
        self.renderFooter();
        self.$newTodo.focus();
      });
		},
		renderFooter: function () {
			var todoCount = this.todos.length;
			var activeTodoCount = this.getActiveTodos().length;
			var template = this.footerTemplate({
				activeTodoCount: activeTodoCount,
				activeTodoWord: util.pluralize(activeTodoCount, 'item'),
				completedTodos: todoCount - activeTodoCount,
				filter: this.filter
			});

			this.$footer.toggle(todoCount > 0).html(template);
		},
		toggleAll: function (e) {
			var isChecked = $(e.target).prop('checked');

			this.todos.forEach(function (todo) {
				todo.completed = isChecked;
			});

			this.render();
		},
		getActiveTodos: function () {
			return this.todos.filter(function (todo) {
				return !todo.completed;
			});
		},
		getCompletedTodos: function () {
			return this.todos.filter(function (todo) {
				return todo.completed;
			});
		},
		getFilteredTodos: function () {
			if (this.filter === 'active') {
				return this.getActiveTodos();
			}

			if (this.filter === 'completed') {
				return this.getCompletedTodos();
			}

			return this.todos;
		},
		destroyCompleted: function () {
			this.todos = this.getActiveTodos();
			this.filter = 'all';
			this.render();
		},
		// accepts an element from inside the `.item` div and
		// returns the corresponding id in the datastore
    idFromEl: function(el) {
      var id = $(el).closest('li').data('id');
      return id;
    },
		create: function (e) {
			var $input = $(e.target);
			var val = $input.val().trim();

			if (e.which !== ENTER_KEY || !val) {
				return;
			}

			this.todos.insert({
				id: util.uuid(),
				title: val,
				completed: false
			});

			$input.val('');
		},
		toggle: function (e) {
      var id = this.idFromEl(e.target);
      var self = this;
      this.todos.findOne({id: id}).then(function(doc) {
        self.todos.findAndModify({id: id}, { $set: { completed: !doc.completed }});
      });
		},
		edit: function (e) {
			var $input = $(e.target).closest('li').addClass('editing').find('.edit');
			$input.val($input.val()).focus();
		},
		editKeyup: function (e) {
			if (e.which === ENTER_KEY) {
				e.target.blur();
			}

			if (e.which === ESCAPE_KEY) {
				$(e.target).data('abort', true).blur();
			}
		},
		update: function (e) {
			var el = e.target;
			var $el = $(el);
			var val = $el.val().trim();

			if ($el.data('abort')) {
				$el.data('abort', false);
				this.render();
				return;
			}

      var self = this;
      var id = this.idFromEl(e.target);
      if (val) {
        self.todos.findAndModify({id: id}, { $set: { title: val }});
      }
      else {
        self.todos.remove({id: id});
      }
		},
		destroy: function (e) {
      var self = this;
      var id = this.idFromEl(e.target);
      self.todos.remove({id: id});
		}
	};

	App.init();
});
