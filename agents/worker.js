'use strict';

/**
 * Chunker Service
 *
 * Handles chunking bodies of text and passing chunks to workers via a message queue
 */

/**
 * Local Dependencies
 */
var hostConfig = require('../config/host.json')
  , amqpSrvc = require('../lib/services/amqp')
  , counterSrvc = require('../lib/services/counter')
  , resultsSrvc = require('../lib/services/results')
  , databaseSrvc = require('../lib/services/database').load('mongo');


/**
 * Immediately acquire a database connection and close it on process exit
 */
var dbConn;
databaseSrvc.getConnection()
    .then(function (conn) {
        dbConn = conn;
        resultsSrvc.setDbConn(conn);
    });

var handleProcessExit = function () {
    databaseSrvc.closeConnection(dbConn);
    process.exit('SIGKILL');
};

process.on('SIGINT', handleProcessExit);
process.on('SIGHUP', handleProcessExit);
process.on('SIGTERM', handleProcessExit);
process.on('uncaughtException', handleProcessExit);

/**
 * Immediatly acquire an AMQP channel and start consuming
 */
amqpSrvc.getChannel(hostConfig.amqp)
    .then(function (channel) {

        channel.consume(hostConfig.amqp.queue, function(msg) {
            
            if (msg !== null) {
                
                channel.ack(msg);

                var chunk;

                try {
                    chunk = JSON.parse(msg.content.toString());
                } catch (err) {
                    console.error('Malformed chunk: ', err);
                    return;
                }

                // Extract the top words from the chunk
                var topWords = counterSrvc.getTopWords(chunk)
                    
                // Store the results of the chunk
                resultsSrvc.storeResults(chunk.requestId, topWords, chunk.totalChunks)
                    .then(function () {
                        console.log('Done processing and storing chunk: ', chunk.requestId, ' -> 1 of ' + chunk.totalChunks);
                    });
            }
        });
    })
    .catch(function (err) {
        throw 'Channel not acquired in worker: ' + err;
    });