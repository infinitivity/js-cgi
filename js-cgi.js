/*Darrel Kathan*/
var cluster = require('cluster'),
	url = require('url'),
	fs = require('fs'),
	vm = require('vm'),
	os = require('os'),
	util = require('util'),
	path = require('path'),
	express = require('express'),
	cookieParser = require('cookie-parser'),
	bodyParser = require('body-parser'),
	multer = require('multer'),
	app = express(),
	config_name = 'js-cgi.config',
	config = {},
	lconsole = {
		log: function(msg){
			var log_msg = '('+process.pid+'): '+msg;
			util.log(log_msg);
			if(config.output_log){
				fs.appendFile(config.output_log, log_msg+'\n', function(){});
			}
		},
		error: function(msg, stack){
			var log_msg = '('+process.pid+'): '+msg;
			util.error(log_msg, stack);
			if(config.output_log){
				fs.appendFile(config.output_log, log_msg+'\n', function(){});
			}
		}
	},
	error = function(err) {
		lconsole.error('Error:'+err);
	};

/*TODO - These should be optional features that are added via a startup script*/
app.use(bodyParser.urlencoded({ extended: false })); // for parsing application/x-www-form-urlencoded
app.use(bodyParser.json()); // for parsing application/json
//app.use(multer()); // for parsing multipart/form-data
app.use(cookieParser());
app.set('json spaces', 4);

config.output_log = path.dirname(process.argv[1])+'/js-cgi.log';
//console.log(config.output_log);
if(fs.existsSync(path.join(__dirname, config_name))){
	//Load the congfig file
	lconsole.log('Loading '+config_name+'...');
	config = require('./'+config_name);
}else{
	//Use the default congfig
	lconsole.log('Loading default config...');
	config.port = 3000;
	config.localhostOnly = true;
	//config.workers = 2;
	config.timeout = 30000;
	config.workers = (os.cpus().length/2)-1;//For some reason cpus.length is reports twice as many cores than actual.
}


if (cluster.isMaster) {
	cluster.globals = {};
	cluster.fork();//At least one worker is required.
	
	for(var w = 2; w <= config.workers;w++){
		cluster.fork().on('error', error);
	}

	cluster.on('disconnect', function(worker) {
		lconsole.error('disconnect!');
		cluster.fork().on('error', error);
	});
} else {
	// the worker
	var domain = require('domain'),
		server,
		d = domain.create();

	d.on('error', function(er) {
		lconsole.error('error', er.stack);
		try {
			// make sure we close down if it times out
			var killtimer = setTimeout(function() {
				lconsole.error('Killing process. Timeout expired ('+config.timeout+' ms)');
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
			lconsole.error(er2.stack);
		}
	});

    // Now run the handler function in the domain.
    d.run(function() {
		lconsole.log('Listening on '+config.port);
      
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
	      	lconsole.log(file_path);
	      	script(req, res, cluster.globals, myRequire);
	      	
	      }catch(err){
	      	res.writeHead(500);
	      	lconsole.error(err.stack)
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
          lconsole.error(err, err.stack);
          res.writeHead(500, err);
          return res.send(err.toString());
        }
        try{
          //console.log('filename:'+file_path);

          var script = vm.createScript('try{\n'+source+'\n}catch(err){console.error(err, err.stack);res.writeHead(500);res.end(err.toString());}');
          //console.log('pre execute:'+g);
          var sandbox = {
                  //globals: globals,
                  console: lconsole,
                  require: function(name) {
                           return require(resolveModule(name));
                       },
                req: req,
                res: res,
                displayErrors: true
            };

          return script.runInNewContext(sandbox);

        }catch(err){
          lconsole.error(err, err.stack);
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
					lconsole.error(err, err.stack);
					res.writeHead(500, err);
					return res.send(err.toString());
				}
				try{
					lconsole.log('Request: '+file_path);
					//console.log(require.cache);
					var sandbox = {
						//globals: globals,
						console: lconsole,
						setImmediate: setImmediate,
						require: function(name) {
							return require(resolveModule(name));
						},
						req: req,
						res: res
					};
					var c = vm.createContext(sandbox);
            	
					return vm.runInContext(source, c, {displayErrors: true});
				}catch(err){
					lconsole.error(err, err.stack);
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
