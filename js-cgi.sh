#!/bin/bash
SCRIPT_FOLDER=`dirname $0`
cd "$SCRIPT_FOLDER"
export DYLD_LIBRARY_PATH=/usr/lib/instantclient_11_2 
/usr/local/bin/node "$SCRIPT_FOLDER/js-cgi.js"