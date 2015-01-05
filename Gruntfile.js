/**
 * Created by michael on 10/9/14.
 */

/* jshint node:true */
module.exports = function (grunt) {
  'use strict';

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    concat: {
      options: {
        separator: ';'
      },
      dist: {
        src: ['src/lowladb.js', 'src/**/*.js'],
        dest: 'dist/<%= pkg.name %>.js'
      }
    },

    uglify: {
      options: {
        banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mmm-dd") %> */\n'
      },
      dist: {
        files: {
          'dist/<%= pkg.name %>.min.js': ['<%= concat.dist.dest %>']
        }
      }
    },

    jshint: {
      files: [
        'Gruntfile.js',
        'src/*.js',
        'tests/**/*.spec.js',
        '!src/vendor/**'],
      options: {
        jshintrc: true
      }
    },

    jscs: {
      files: [ '<%= jshint.files %>' ]
    },

    karma: {
      options: {
        configFile: 'karma.conf.js',
        browsers: [ grunt.option('browsers') || 'Chrome' ]
      },

      once: {
        singleRun: true
      },

      watch: {
        background: true,
        singleRun: false
      }
    },

    watch: {
      files: ['<%= jshint.files %>'],
      tasks: ['jshint', 'karma:watch:run']
    }
  });

  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-karma');
  grunt.loadNpmTasks('grunt-jscs');

  grunt.registerTask('lint', ['jshint', 'jscs']);
  grunt.registerTask('test', ['lint', 'karma:once']);
  grunt.registerTask('server', ['karma:watch:start', 'watch']);
  grunt.registerTask('default', ['lint', 'karma:once', 'concat', 'uglify']);
};
