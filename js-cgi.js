/*******************************************
* js-cgi.js
* Copyright (c) 2015, Darrel Kathan 
* Licensed under the MIT license.
*
* A current version and some documentation is available at
*    https://github.com/kathan/js-cgi
*
* @summary     Javascript CGI process manager
* @description js-cgi is a javascript CGI process manager, similar to php-fpm, for executing node.js/io.js compatible scripts behind NGINX or Apache.
* @file        js-cgi.js
* @version     0.1.0
* @author      Darrel Kathan
* @license     MIT
*******************************************/
'use strict';

var cluster = require('cluster'),
	url = require('url'),
	//fs = require('fs'),
	fs = require('graceful-fs'),
	vm = require('vm'),
	os = require('os'),
	util = require('util'),
	path = require('path'),
	express = require('express'),
	bodyParser = require('body-parser'),
	cookieParser = require('cookie-parser'),
	app = express(),
	config_name = 'js-cgi.config',
	config = {};

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

/*******************************************
* Funnel console.log and console.error 
* input to log file.
*******************************************/
var console_log = console.log,
	console_error = console.error;

console.log = function(){
	var d = new Date(),
		log_msg = d.toString()+' - ('+process.pid+'): ';
    if(config.output_log){
		fs.appendFile(config.output_log, log_msg + util.format.apply(this, arguments) + '\n', function(){return;});
	}

    return console_log.apply(this, arguments);
};

/*console.log = function(){
	var d = new Date(),
		log_msg = d.toString()+' - ('+process.pid+'): ',
		stack = new Error().stack;
		
	this._stdout.write(log_msg + util.format.apply(this, arguments) + stack + '\n');
	if(config.output_log){
		fs.appendFile(config.output_log, log_msg + util.format.apply(this, arguments) + '\n', function(){return;});
	}
};*/

console.error = function(err){
	var d = new Date(),
		log_msg = d.toString()+' - ('+process.pid+'): ',
		stack = new Error().stack;
		
	if(config.output_log){
		fs.appendFile(config.output_log, log_msg+'\n', function(){return;});
		fs.appendFile(config.output_log, err.stack+'\n', function(){return;});
	}
	return console_error.apply(this, arguments);
};

/*******************************************
* Prepare web server to handle cookies and
* format JSON.
*******************************************/
app.use(cookieParser());
app.set('json spaces', 4);

//console.log(config.output_log);
if(fs.existsSync(path.join(__dirname, config_name))){
	//Load the congfig file
	console.log('Loading '+config_name+'...');
	config = require('./'+config_name);
}

//Set default config items
!config.output_log ? config.output_log = path.dirname(process.argv[1])+'/js-cgi.log' : '';
!config.port ? config.port = 3000 : '';
!config.localhostOnly ? config.localhostOnly = true : '';
!config.timeout ? config.timeout = 30000 : '';
!config.workers ? config.workers = (os.cpus().length/2)-1 : '';//For some reason cpus.length is reports twice as many cores than actual.
!config.watch_required ? config.watch_required = false : '';


/*******************************************
* Override the "require" function to watch
* if required files have change and expire
* them from cache when they do.
*******************************************/
var assert = require('assert').ok,
	Module = require('module');
if(typeof Module._watching !== 'object'){
	Module._watching = {};
}
function watchRequired(fn){
	/*var fs = require('fs')
		console = console;*/
	//console.log(fn);
	if(Module._watching && !Module._watching.hasOwnProperty(fn)){
		if(fs.existsSync(fn) && !Module._watching.hasOwnProperty(fn)){
			console.log('Watching '+fn);
			Module._watching[fn] = fs.watch(fn, function(event,f){
			//Module._watching[fn] = fs.watchFile(fn, function(curr, prev){
				console.log(fn, event);
				
				if(Module._cache.hasOwnProperty(fn)){
					console.log('Expiring '+fn);
					//fs.unwatch(fn, function(){return;});
					return delete Module._cache[fn];
				}
				return;
			});
		}
	}
}

Module.prototype.require = function(path) {
  assert(path, 'missing path');
  assert((typeof path === 'string'), 'path must be a string');
  if(config.watch_required){
	  watchRequired(Module._resolveFilename(path, this));
  }
  return Module._load(path, this);
};

/*******************************************
* Start up the server node.
*******************************************/
if (cluster.isMaster) {
	cluster.globals = {};
	cluster.fork();//At least one worker is required.
	console.log(process.versions);
	for(var w = 2; w <= config.workers;w++){
		cluster.fork().on('error', console.error);
	}

	cluster.on('disconnect', function(worker) {
		var e = new Error('disconnect!');
		//console.error(e);
		cluster.fork().on('error', console.error);
	});
} else {
	// the worker
	var domain = require('domain'),
		server,
		d = domain.create();

	d.on('error', function(er) {
		console.error(er);
		try {
			// make sure we close down if it times out
			var killtimer = setTimeout(function() {
				var err = new Error('Killing process. Timeout expired ('+config.timeout+' ms)')
				console.error(err);
				return process.exit(1);
			}, config.timeout);
			// But don't keep the process open just for that!
			killtimer.unref();

			// stop taking new requests.
			server.close();

			// Let the master know we're dead.  This will trigger a
			// 'disconnect' in the cluster master, and then it will fork
			// a new worker.
			cluster.worker.disconnect();
		} catch (er2) {
			// oh well, not much we can do at this point.
			console.error(er2);
		}
	});

    /*******************************************
    * Now run the handler function in the domain.
    *******************************************/
    d.run(function() {
		console.log('Listening on '+config.port);
      
		server = app.listen(config.port);

		app.all('*', function(req, res){
			//console.log('req');
			return handleRequest(req, res);
		});
	});
}

function setRequiredCacheTimestamp(name){
	if(require.cache[process.execPath][name]){
		return require.cache[process.execPath][name];
	}
}

/*******************************************
* This is where all of the web requests are
* handled.
*******************************************/
function handleRequest(req, res) {
	
	var url_obj = url.parse(req.url, true),
		file_path;
	/*if(config.localhostOnly && req.connection.remoteAddress !== '127.0.0.1'){
		//res.writeHead(401);
		res.end(401);
	}*/

	if(req.headers.path_translated && url_obj.pathname){
		file_path = req.headers.path_translated+url_obj.pathname;
	}else{
		file_path = url_obj.pathname;
	}
	console.log('Request: '+file_path);
	//console.log('file_path:'+file_path);
	function resolveModule(module) {
		if (module.charAt(0) !== '.'){
			//console.log('No need to resolve '+module);
			return module;
		}
		//console.log('Resolved '+module+' to '+path.resolve(path.dirname(file_path), module));
		return path.resolve(path.dirname(file_path), module);
	}

	//If the requested file exists...
	fs.exists(file_path, function(exists){
		if(exists){
			fs.readFile(file_path, function (err, source) {
				if(err){
					//Error reading file
					console.error(err);
					res.writeHead(500, err);
					return res.send(err.toString());
				}
				try{
					
					//console.log(require.cache);
					var sandbox = {
						//globals: globals,
						console: console,
						setImmediate: setImmediate,
						setInterval: setInterval,
						JSON: JSON,
						require: function(name) {
							var mod_path = resolveModule(name);
							//watchRequired(mod_path);
							return require(mod_path);
						},
						req: req,
						res: res,
						process: process
					};
					var c = vm.createContext(sandbox);
            		//return vm.runInContext(source, c, {displayErrors: true});
					return vm.runInContext('(function(){try{'+source+'}catch(e){console.error(e);return res.status(500).send({err: e.toString(), stack: e.stack});}})();', c, {displayErrors: true});
					//return vm.runInContext('function runInContext() {try{'+source+'}catch(e){console.error(e);res.status(500).send({err: e.toString(), stack: e.stack});}} runInContext();', c, {displayErrors: true});
				}catch(err){
					console.error(err);
					//res.writeHead(500);
					return res.status(500).send(err.toString());
				}
			});
		}else{
			//File does not exist
			//res.writeHead(404, 'File not found.');
			return res.status(404).send('File not found.');
		}
	});
}