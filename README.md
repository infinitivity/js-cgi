# js-cgi  - Javascript CGI process manager
js-cgi is a javascript CGI process manager, similar to php-fpm, for executing node.js or io.js compatible scripts behind Apache or NGINX.

This is experimental and not production ready!

####Dependencies:
express.js

####Configuration:
On startup, js-cgi will look for a config file called `js-cgi.config` in the same folder as the js-cgi.js file.

Example:
```js
module.exports = {
				port:3000,
				localhostOnly:true,
				workers:2
			};

```

port - Indicates which TCP port to listen on. default=3000.

localhostOnly - Prevents non-local agents from invoking scripts. default=true.

workers - Number of process workers. default=2
####Usage:
```sh
node js-cgi.js
```
