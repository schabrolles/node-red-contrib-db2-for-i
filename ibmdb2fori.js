    module.exports = function(RED) {    
        //"use strict"; 
        
        var Promise = require('promise');
        // Requires native DB2 driver - non blocking version : Node-RED flow has to run locally on IBM i, for now. JDBC/ODBC driver use to come.
        // Hardcoded path..todo: make it more flexible
        var db = require('/QOpenSys/QIBM/ProdData/OPS/Node6/os400/db2i/lib/db2a');
        
        // Keep-Alive timeout of reconnect time. Keeping a connection for performance. If keepAlive=false, connect-query-disconnect mode. 
        var db2foriKeepAliveTimout = RED.settings.db2foriKeepAliveTimout || 1800000;  //default: 30 minutes
         
        function ibmdb2foriNode(n) {
            RED.nodes.createNode(this,n);
            this.connected = false;
            this.connecting = false;
            this.cnnname=n.cnnname;           
            this.dbname = n.db;
            this.dbconn=n.dbconn;
            this.connectionTime = 0;
            this.keepalive=n.keepalive;
            
            var node = this;
            
            
            
            function doConnect(conncb) {
                node.connecting = true;
                
                node.emit("state","connecting");
                node.conn = {};
                this.dbconn = new db.dbconn();
                node.connection = {
                    connect: (cb) => {
                        
                         // Connection to the DB. will be reused by other nodes if needed 
                      if ( (node.credentials.user == null  &&  node.credentials.password == null) || (node.credentials.user == ''  &&  node.credentials.password == '')  )
                           {
                             this.dbconn.conn(node.dbname);
                             console.log("No user/password specified: Connecting with current user profile" );  
                           }
                        else{
                            this.dbconn.conn(node.dbname, node.credentials.user, node.credentials.password); 
                            console.log("Connecting with specified user profile" );  
                        }
                        
                      cb(null, this.dbconn);    
                    },
                    end: (conn) => {
                        //console.log("deleting connection" );
                        delete node.dbconn;
                        //console.log('connection closed');
                      
                    }
                };
                node.connection.connect(function(err, conn) {

                    
                    node.connecting = false;
                    if (err) {
                        node.error(err);
                        console.log("connection error " + err);
                        
                    } else {
                        node.dbconn = conn;
                        node.connected = true;
                        
                    }
                    conncb(err);
                    
                    node.connectionTime = new Date().getTime();
                    //console.log("connectionTime== " + node.connectionTime+" with "+node.dbconn);
                });
            }

            
                
            
            this.connect = function() {
                return new Promise((resolve, reject) => {
                    
                  //  if (!this.connected && !this.connecting) {
                  
                        doConnect((err)=>{
                            if(err) reject(err);
                            else resolve();
                        });
                 /*   }  
                    else{
                        resolve();
                    }  */
                });
            }
            
              
            
            this.on('close', function (done) {
                if (this.connection) {
                    node.connection.end(this.dbconn);
                } 
                done();
            });
        }

        RED.nodes.registerType("DB2 for i Config", ibmdb2foriNode, {
            credentials: {
                user: {type: "text"},
                password: {type: "password"}
            }
        });

        function ibmdb2foriNodeIn(n) {

            RED.nodes.createNode(this,n);
            this.mydb = n.mydb;
            this.arraymode = n.arraymode;
            //this.keepalivemode= n.nopoolmode;
            var node = this;
            
            
            node.query = function(node, db2, msg){
                
    
                if ( msg.payload !== null && typeof msg.payload === 'string' && msg.payload !== '') {
                    
                    //console.log("Processing SQL Query with "+ db2.dbconn+ " "+msg.payload);
                    try{
                        var sqlB = new db.dbstmt(db2.dbconn);
                   
                        
                    sqlB.exec(msg.payload, function(rows) {
                        
                        
                          
                    if (!node.arraymode)        
                        {   
                            rows = rows.length==0?[""]:rows; //issue 0.1.1 - if rows is empty, return an empty row
                            rows.forEach(function(row) {
                                
                                msg.payload=row;
                                node.send(msg);
                                // bug - erase msg content corrected 0.0.9 - node.send({ topic: msg.topic, payload: row } );
                                
                            })
                        }
                        else
                        {
                            msg.payload=rows;
                            node.send(msg);
                 
                        }
                            
                        node.send([ null, { topic: msg.topic, control: 'end' }]);
                        
                    });
                    delete sqlB;
                   
                     var time = new Date().getTime();  
                        
                    if (!db2.keepalive || ( time-db2.connectionTime >= db2foriKeepAliveTimout )  ){   // 60 secondes
                                
                            //db2.dbconn.disconn(); // bug with disconn(), close() API error. To be fixed for QUSER/QSQSRVR jobs cleanup
                            delete db2.dbconn;
                            db2.dbconn=null;
                         
                                                     
                        }
                        time=null;
                    }
                     
                    catch(e)
                        {
                             console.log("Error while executing a DB statement...");
                             node.error("Error while executing a DB statement...");
                             db2.dbconn=null;
                            
                        }
                    }
                else {
                    if (msg.payload === null) { 
                        node.error("msg.payload : the query is not defined");
                    }
                    if (typeof msg.payload !== 'string') { 
                        node.error("msg.payload : the query is not defined as a string");
                    }
                    if (typeof msg.payload === 'string' && msg.payload === '') { 
                        node.error("msg.payload : the query string is empty");
                    }
                }
                    
            }

            node.on("input", (msg) => {
                
                if ( msg.database == null ) {
                     // Simple mode - when you don't specify a connection name dynamically in msg.database - use the one in the Db2 for i config node attached.
                    msg.database ="simple-mode";          
                 }
                
                node.mydbNode = RED.nodes.getNode(n.mydb);
                    
                    //if a node config already there
                    if (node.mydbNode) {
                        
                       node.send([ null, { control: 'start', query: msg.payload, database: n.mydb } ]);
                        // if a connection already exists to this particular "database". for connection reuse. not pooling yet :)
                        
                      var findNode;
                      RED.nodes.eachNode((node)=>{
                                
                       if(node.cnnname && node.cnnname === msg.database){
                                      findNode = RED.nodes.getNode(node.id);
                                      node.mydb = node.id;
                                      console.log("Connection name specified in msg.database. Connection using Db2 Config node : "+ node.cnnname);
                                }
                            })
                      
                        if (findNode == null && msg.database!=null && msg.database !="simple-mode")
                                {
                                    console.log("msg.database is not matching any Connection Name in a DB2 for i config node");  
                                    this.error("msg.database is not matching any Connection Name in a Db2 for i config node");
                                    this.status({fill:"red",shape:"ring",text:"disconnected"});
                                }
                        else
                            {
                        if (findNode == null)
                                { 
                                  findNode = RED.nodes.getNode(n.mydb);
                                     console.log("Simple Mode. Connection using Db2 Config node : "+ findNode.cnnname );
                                     //console.log("Simple Mode. Connection status: " + findNode.dbconn);
                                }
                                                
                        
                        if( findNode.dbconn && ( findNode.cnnname === msg.database || msg.database =="simple-mode")) {
                            console.log("Already connected to DB2 for i with this connection");
                            node.query(node, findNode, msg);
                                                     
                        }
                        // if a connection - or config node - to this particular does not exist: get the appropriate config node & Get a connection with connect() 
                        // if a config node does not exist for this system and database, fails.
                        else{
                            //console.log("connection!");   
                            //we found the config node whose dbname equals the injected input msg.database payload. let's connect for the first time, we'll reuse it. 
                            findNode.connect();
                           
                                this.status({fill:"green",shape:"dot",text:"connected"});
                                // we are connected, let's query our database using the DB2 API exec() 
                                node.query(node, findNode, msg);
                                               } 
                            }
                        
                    }
                    else {
                        this.error("database not configured");
                        this.status({fill:"red",shape:"ring",text:"disconnected"});
                    }
          
            });
        }
        RED.nodes.registerType("DB2 for i", ibmdb2foriNodeIn);
    }

