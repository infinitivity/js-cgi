# js-cgi  - Javascript CGI process manager
js-cgi is a javascript CGI process manager, similar to php-fpm, for executing node.js or io.js compatible scripts behind NGINX or Apache.

This is experimental and not production ready!

####Dependencies:
express.js

####Configuration:
On startup, js-cgi will look for a config file called `js-cgi.config` in the same folder as the js-cgi.js file. If it's not found it will use the defaults.

Example:
```js
module.exports = {
   port:3000,
   localhostOnly:true,
   workers:2
};

```

port - Indicates which TCP port to listen on. default=3000

localhostOnly - Prevents non-local agents from invoking scripts. default=true

workers - Number of worker processes. default=2
####Usage:
Add a directive to your `nginx.conf` file. I use an "njs" extension on the server javascript files instead of a "js" extension so NGINX won't confuse them with browser javascript files.
```
location ~ [^/]\.njs(/|$) {
   proxy_pass   http://localhost:3000;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header Host $http_host;
   proxy_set_header X-NginX-Proxy true;
   proxy_set_header path_translated $document_root$fastcgi_path_info;
}
```
Once you configure and restart NGINX, you can start js-cgi.
```sh
node js-cgi.js
```
