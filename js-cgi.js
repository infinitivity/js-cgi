/**/
var cluster = require('cluster'),
  url = require('url'),
  fs = require('fs'),
  vm = require('vm'),
  path = require('path'),
  express = require('express'),
  app = express(),
  config_name = 'js-cgi.config',
  config,
  globals = {},
  error = function(err) {
      console.log('Error:'+err);
  };

if(fs.existsSync(path.join(__dirname, config_name))){
  //Load the congfig file
  console.log('Loading '+config_name+'...');
  config = require('./'+config_name);
}else{
  //Use the default congfig
  console.log('Loading default config...');
  config =
    {
      port:3000,
      localhostOnly:true,
      workers:2
    };
}

if (cluster.isMaster) {
  cluster.fork();//At least one worker is required.
  var w;
  for(w = 2; w <= config.workers;w++){
    cluster.fork().on('error', error);
  }

  cluster.on('disconnect', function(worker) {
    console.error('disconnect!');
    cluster.fork().on('error', error);
  });
} else {
  // the worker
  var domain = require('domain'),
    server;

  //var server = require('http').createServer(function(req, res) {

    var d = domain.create();
    d.on('error', function(er) {
      console.error('error', er.stack);
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
        //res.statusCode = 500;
        //res.setHeader('content-type', 'text/plain');
        //res.end('Oops, there was a problem!\n');
      } catch (er2) {
        // oh well, not much we can do at this point.
        console.error('Error sending 500!', er2.stack);
        //res.end(er2.toString());
      }
    });

    // Now run the handler function in the domain.
    d.run(function() {
      console.log('Listening on '+config.port);
      server = app.listen(config.port);

      app.all('*', function(req, res){
        console.log('req');
        handleRequest(req, res);
      });
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
  }
  var file_path;
  if(req.headers.path_translated && url_obj.pathname){
    file_path = req.headers.path_translated+url_obj.pathname;
  }else{
    file_path = url_obj.pathname;
  }
  console.log('file_path:'+file_path);

  //If the requested file exists...
  fs.exists(file_path, function(exists){
    if(exists){
      fs.readFile(file_path, function (err, source) {
        if(err){
          //Error reading file
          console.log(err, err.stack);
          res.writeHead(500, err);
          res.end(err.toString());
        }
        try{
          //console.log('filename:'+file_path);

          var script = vm.createScript('try{\n'+source+'\n}catch(err){console.log(err, JSON.stringify(err.stack));res.writeHead(500);res.end(err.toString());}');
          console.log(globals);
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
          console.log(err, err.stack);
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
