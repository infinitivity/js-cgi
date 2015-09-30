/*Darrel Kathan*/
'use strict';

var cluster = require('cluster'),
	url = require('url'),
	fs = require('fs'),
	vm = require('vm'),
	os = require('os'),
	util = require('util'),
	path = require('path'),
	express = require('express'),
	cookieParser = require('cookie-parser'),
	app = express(),
	config_name = 'js-cgi.config',
	config = {},
	error = function(err) {
		console.error('Error:'+err);
	};

/* Override console.log to write messages to log file. */
console.log = function(){
	var d = new Date(),
		log_msg = d.toString()+' - ('+process.pid+'): ',
		stack = new Error().stack;
		
	this._stdout.write(log_msg + util.format.apply(this, arguments) + stack + '\n');
	if(config.output_log){
		fs.appendFile(config.output_log, log_msg + util.format.apply(this, arguments) + '\n', function(){return;});
	}
};

console.error = function(msg, stack){
	var d = new Date(),
		log_msg = d.toString()+' - ('+process.pid+'): '+msg;
	util.error(log_msg, stack);
	if(config.output_log){
		fs.appendFile(config.output_log, log_msg+'\n', function(){});
		fs.appendFile(config.output_log, stack+'\n', function(){return;});
	}
};

app.use(cookieParser());
app.set('json spaces', 4);

config.output_log = path.dirname(process.argv[1])+'/js-cgi.log';
//console.log(config.output_log);
if(fs.existsSync(path.join(__dirname, config_name))){
	//Load the congfig file
	console.log('Loading '+config_name+'...');
	config = require('./'+config_name);
}else{
	//Use the default congfig
	console.log('Loading default config...');
	config.port = 3000;
	config.localhostOnly = true;
	//config.workers = 2;
	config.timeout = 30000;
	config.workers = (os.cpus().length/2)-1;//For some reason cpus.length is reports twice as many cores than actual.
}

/* Override the "require" function to watch if required files have change and expire them from cache when they do*/
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
		if(fs.existsSync(fn)){
			console.log('Watching '+fn);
			Module._watching[fn] = fs.watch(fn, function(event,f){
			//Module._watching[fn] = fs.watchFile(fn, function(curr, prev){
				console.log(fn, event);
				
				if(Module._cache.hasOwnProperty(fn)){
					console.log('Expiring '+fn);
					return delete Module._cache[fn];
					//fs.unwatch(fn, function(){return;});
				}
				return;
			});
		}
	}
}

Module.prototype.require = function(path) {
  assert(path, 'missing path');
  assert((typeof path === 'string'), 'path must be a string');
  watchRequired(Module._resolveFilename(path, this));
  return Module._load(path, this);
};

/* Start up the server node */
if (cluster.isMaster) {
	cluster.globals = {};
	cluster.fork();//At least one worker is required.
	
	for(var w = 2; w <= config.workers;w++){
		cluster.fork().on('error', error);
	}

	cluster.on('disconnect', function(worker) {
		console.error('disconnect!');
		cluster.fork().on('error', error);
	});
} else {
	// the worker
	var domain = require('domain'),
		server,
		d = domain.create();

	d.on('error', function(er) {
		console.error('error', er.stack);
		try {
			// make sure we close down if it times out
			var killtimer = setTimeout(function() {
				console.error('Killing process. Timeout expired ('+config.timeout+' ms)');
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
			console.error(er2.stack);
		}
	});

    // Now run the handler function in the domain.
    d.run(function() {
		console.log('Listening on '+config.port);
      
		server = app.listen(config.port);

		app.all('*', function(req, res){
			//console.log('req');
			return handleRequest(req, res);
		});
	});
}

function clearRequiredCache(name){
	
}

function setRequiredCacheTimestamp(name){
	if(require.cache[process.execPath][name]){
		return require.cache[process.execPath][name];
	}
}

function handleRequestScript(req, res) {
  var url_obj = url.parse(req.url, true);
  /*if(config.localhostOnly && req.connection.remoteAddress !== '127.0.0.1'){
    //res.writeHead(401);
    res.end(401);
  }*/

  var file_path;
  if(req.headers.path_translated && url_obj.pathname){
    file_path = req.headers.path_translated+url_obj.pathname;
  }else{
    file_path = url_obj.pathname;
  }
  
  function resolveModule(module) {
    if (module.charAt(0) !== '.'){
      //console.log('No need to resolve '+module);
      return module;
    }
    //console.log('Resolved '+module+' to '+path.resolve(path.dirname(file_path), module));
    return path.resolve(path.dirname(file_path), module);
  }
  
  function myRequire(name) {
    return require(resolveModule(name));
  }
  
  //If the requested file exists...
  fs.exists(file_path, function(exists){
    if(exists){
    	fs.readFile(file_path, function(err, content){
	      try{
	      	var path_dir = file_path.split("/");
	      	path_dir.pop();
	      	path_dir = path_dir.join('/');
	      	//console.log(path_dir);
	      	process.chdir(path_dir);
	      	//console.log(process.cwd());
	      	var script = Function('req', 'res', 'globals', 'require', content);
	      	//console.log(script.toString());
	      	console.log(file_path);
	      	script(req, res, cluster.globals, myRequire);
	      	
	      }catch(err){
	      	res.writeHead(500);
	      	console.error(err.stack)
	      	res.end(err+' in '+file_path);
	      }
	    });
    }else{
      //File does not exist
      res.writeHead(404, 'File not found.');
      res.end('File '+file_path+' not found.');
    }
  });
}

function handleRequestRequire(req, res) {
  var url_obj = url.parse(req.url, true);
  /*if(config.localhostOnly && req.connection.remoteAddress !== '127.0.0.1'){
    //res.writeHead(401);
    res.end(401);
  }*/

  var file_path;
  if(req.headers.path_translated && url_obj.pathname){
    file_path = req.headers.path_translated+url_obj.pathname;
  }else{
    file_path = url_obj.pathname;
  }
  
  //If the requested file exists...
  fs.exists(file_path, function(exists){
    if(exists){
      var script = require(file_path);
      if(typeof script === 'function'){
      	script(req, res, cluster.globals);
      }else{
      	res.writeHead(500);
      	return res.send('Script is not configured correctly.');
      }
    }else{
      //File does not exist
      res.writeHead(404, 'File not found.');
      return res.send('File '+file_path+' not found.');
    }
  });
}

function handleRequestRIC(req, res) {
  var url_obj = url.parse(req.url, true);
  /*if(config.localhostOnly && req.connection.remoteAddress !== '127.0.0.1'){
    //res.writeHead(401);
    res.end(401);
  }*/

  var file_path;
  if(req.headers.path_translated && url_obj.pathname){
    file_path = req.headers.path_translated+url_obj.pathname;
  }else{
    file_path = url_obj.pathname;
  }
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
          console.error(err, err.stack);
          res.writeHead(500, err);
          return res.send(err.toString());
        }
        try{
          //console.log('filename:'+file_path);

          //var script = vm.createScript('try{\n'+source+'\n}catch(err){console.error(err, err.stack);res.writeHead(500);res.end(err.toString());}');
          var script = vm.createScript(source);
          //console.log('pre execute:'+g);
          var sandbox = {
                  //globals: globals,
                  console: console,
                  require: function(name) {
                           return require(resolveModule(name));
                       },
                req: req,
                res: res,
                displayErrors: true
            };

          return script.runInNewContext(sandbox);

        }catch(err){
          console.error(err, err.stack);
          res.writeHead(500);
          return res.send(err.toString());
        }
      });
    }else{
      //File does not exist
      res.writeHead(404, 'File not found.');
      return res.send('File not found.');
    }
  });
}

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
					console.error(err, err.stack);
					res.writeHead(500, err);
					return res.send(err.toString());
				}
				try{
					console.log('Request: '+file_path);
					//console.log(require.cache);
					var sandbox = {
						//globals: globals,
						console: console,
						setImmediate: setImmediate,
						require: function(name) {
							var mod_path = resolveModule(name);
							//watchRequired(mod_path);
							return require(mod_path);
						},
						req: req,
						res: res
					};
					var c = vm.createContext(sandbox);
            	
					return vm.runInContext(source, c, {displayErrors: true});
				}catch(err){
					console.error(err, err.stack);
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
