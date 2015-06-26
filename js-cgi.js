var cluster = require('cluster'),
	url = require('url'),
	fs = require('fs'),
	vm = require('vm'),
	https = require('https'),
	http = require('http'),
	path = require('path'),
	express = require('express'),
	app = express(),
	config_name = 'nodejs-cgi.config'
	globals = {};
	
if(fs.existsSync(path.join(__dirname, config_name))){
		console.log('Loading '+config_name+'...');
		var config = require('./'+config_name);
	}else{
		console.log('Loading default config...');
		var config = {
				port:3000,
				localhostOnly:true,
				workers:2
			};
	}

error =  function(err) {
  	console.log('Some bad stuff happened.');
};
if (cluster.isMaster) {
  // In real life, you'd probably use more than just 2 workers,
  // and perhaps not put the master and worker in the same file.
  //
  // You can also of course get a bit fancier about logging, and
  // implement whatever custom logic you need to prevent DoS
  // attacks and other bad behavior.
  //
  // See the options in the cluster documentation.
  //
  // The important thing is that the master does very little,
  // increasing our resilience to unexpected errors.
	
  cluster.fork();//At least one worker is required.
  for(var w=2; w <= config.workers;w++){
  	cluster.fork().on('error', error);
  }
 
  cluster.on('disconnect', function(worker) {
    console.error('disconnect!');
    cluster.fork().on('error', error);
  });
  
	
} else {
  // the worker
  //
  // This is where we put our bugs!

  var domain = require('domain');

  // See the cluster documentation for more details about using
  // worker processes to serve requests.  How it works, caveats, etc.

  //var server = require('http').createServer(function(req, res) {
  
    var d = domain.create();
    d.on('error', function(er) {
      console.error('error', er.stack);
		//res.statusCode = 500;
        //res.setHeader('content-type', 'text/plain');
        //res.end('Oops, there was a problem!\n');
      // Note: we're in dangerous territory!
      // By definition, something unexpected occurred,
      // which we probably didn't want.
      // Anything can happen now!  Be very careful!

      try {
        // make sure we close down within 30 seconds
        var killtimer = setTimeout(function() {
          process.exit(1);
        }, 30000);
        // But don't keep the process open just for that!
        killtimer.unref();

        // stop taking new requests.
        server.close();

        // Let the master know we're dead.  This will trigger a
        // 'disconnect' in the cluster master, and then it will fork
        // a new worker.
        cluster.worker.disconnect();

        // try to send an error to the request that triggered the problem
        res.statusCode = 500;
        res.setHeader('content-type', 'text/plain');
        res.end('Oops, there was a problem!\n');
      } catch (er2) {
        // oh well, not much we can do at this point.
        console.error('Error sending 500!', er2.stack);
        res.end(er2.toString());
      }
    });

    // Because req and res were created before this domain existed,
    // we need to explicitly add them.
    // See the explanation of implicit vs explicit binding below.
    //d.add(req);
    //d.add(res);

    // Now run the handler function in the domain.
    d.run(function() {
    	console.log('Listening on '+config.port);
    	app.listen(config.port);

    	app.all('*', function(req, res){
    		console.log('req');
  			handleRequest(req, res);
		});
		
    });
  
  
  
}


function handleRequestJailed(req, res) {
	var url_obj = url.parse(req.url, true);
	/*if(config.localhostOnly && req.connection.remoteAddress !== '127.0.0.1'){
		//res.writeHead(401);
		res.end(401);
	}*/

	function resolveModule(module) {
		if (module.charAt(0) !== '.'){ 
			//console.log('No need to resolve '+module);
			return module;
		}
		//console.log('Resolved '+module+' to '+path.resolve(path.dirname(file_path), module));
		return path.resolve(path.dirname(file_path), module);
	};
	if(req.headers.path_translated && url_obj.pathname){
		var file_path = req.headers.path_translated+url_obj.pathname;
	}else{
		var file_path = url_obj.pathname;
	}
	console.log('file_path:'+file_path);
	fs.exists(file_path, function(exists){
		if(exists){
			try{
				var sandbox = {
						console: console,
						require: function(name) {
       	 					return require(resolveModule(name));
       					},
					req: req,
					res: res
					};
						
				var plugin = new jailed.Plugin(file_path, sandbox);
				
			}catch(err){
				console.log(err);
				res.writeHead(500);
				res.end(err.toString());
			}
			
		}else{
			//File does not exist
			res.writeHead(404, 'File not found.');
			res.end('File not found.');
		}
	});
}

function handleRequest(req, res) {
	var url_obj = url.parse(req.url, true);
	/*if(config.localhostOnly && req.connection.remoteAddress !== '127.0.0.1'){
		//res.writeHead(401);
		res.end(401);
	}*/

	function resolveModule(module) {
		if (module.charAt(0) !== '.'){ 
			//console.log('No need to resolve '+module);
			return module;
		}
		//console.log('Resolved '+module+' to '+path.resolve(path.dirname(file_path), module));
		return path.resolve(path.dirname(file_path), module);
	};
	if(req.headers.path_translated && url_obj.pathname){
		var file_path = req.headers.path_translated+url_obj.pathname;
	}else{
		var file_path = url_obj.pathname;
	}
	console.log('file_path:'+file_path);
	fs.exists(file_path, function(exists){
		if(exists){
			fs.readFile(file_path, function (err, source) {
				if(err){
					//Error reading file
					res.writeHead(500, err);
					res.end(err.toString());
				}
				try{
					//console.log('filename:'+file_path);

					var script = vm.createScript(source);
					var sandbox = {
									globals: globals,
									console: console,
									require: function(name) {
       	    							return require(resolveModule(name));
       								},
								req: req,
								res: res,
								displayErrors: true
						};
						
					script.runInNewContext(sandbox);
				
				}catch(err){
					console.log(err);
					res.writeHead(500);
					res.end(err.toString());
				}
			});
		}else{
			//File does not exist
			res.writeHead(404, 'File not found.');
			res.end('File not found.');
		}
	});
}