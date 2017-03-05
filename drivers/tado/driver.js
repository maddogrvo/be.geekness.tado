"use strict";

var _               = require('lodash');
var path            = require('path');
var request         = require('request');
var extend          = require('util')._extend;
var api_url         = 'https://my.tado.com/api/v2';
var debug = true;
var loggedin = false;
var devices = {};

var self = module.exports = {

    init: function( devices_data, callback ) {

        log('[TADO] Initializing.. ' + devices_data.length + ' devices found.');

        devices_data.forEach( function( device_data ){
            devices[ device_data.id ] = {
                data    : device_data,
                state   : {}
            };
        });

        getAccessToken( function( err, access_token ) {
            for (var device_id in devices) {
                devices[device_id].data.access_token = access_token;
                getState( devices[device_id].data, callback );
            }
        });

        // update info every 5 minutes
        setInterval(function(){
            log('[TADO] Recurring Interval');
            getAccessToken( function( err, access_token ) {
                for (var device_id in devices) {
                    devices[device_id].data.access_token = access_token;
                    getState( devices[device_id].data );
                }
            });
        }, 1000 * 60 * 5);

        Homey.manager('flow').on('trigger.weather_state', function( callback, args, state ) {
            if ( args.current_state == state.state ) {
                callback( null, true );
            } else {
                callback( null, false );
            }
        });

        Homey.manager('flow').on('condition.weather_state', function( callback, args ) {
            if (devices[0] !== undefined) {
                if ( args.current_state == devices[0].state.weather_state ) {
                    callback( null, true );
                    return;
                }
            }
            callback( null, false );
        });

        Homey.manager('flow').on('action.set_auto', function( callback, args ){
            for (var i in devices) {
                if (devices[i].data) {
                    updateTado( devices[i].data, 'DELETE');
                }
            }

            callback( null, true ); 
        });

        Homey.manager('flow').on('action.set_off', function( callback, args ){
            for (var i in devices) {
                if (devices[i].data) {
                    updateTado( devices[i].data, {
                        setting: {
                            type: "HEATING",
                            power: "OFF",
                        },
                        termination: {type: "MANUAL"}
                    });
                }
            }

            callback( null, true ); 
        });

        if (devices_data.length === 0) {
            callback();
        }

    },

    deleted: function( device_data ) {
        log('[TADO] Deleting Tado', device_data.id);
        delete devices[ device_data.id ];
    },

    capabilities: {
        target_temperature: {
            get: function( device_data, callback ){

                var device = devices[ device_data.id ];

                if (typeof device == 'undefined') return callback( new Error("invalid_device") );
                if (device.state === undefined || device.state.target_temperature === undefined) return callback( new Error('Device initialization unfinished') );

                log('[TADO] Capability: Get Target Temperature (= ' + device.state.target_temperature.toString() + ')');

                callback( null, device.state.target_temperature );
            },
            set: function( device_data, target_temperature, callback ){

                if (!loggedin) return callback( new Error("no_session") );

                log('[TADO] Capability: Set Target Temperature to ' + target_temperature.toString());
                var device = devices[ device_data.id ];

                if (typeof device == 'undefined') return callback( new Error("invalid_device") );

                // limit temperature
                if (target_temperature < 5) target_temperature = 5;
                if (target_temperature > 30) target_temperature = 30;

                // update if different
                if (target_temperature != device.state.target_temperature) {
                
                    target_temperature = (target_temperature * 2).toFixed() / 2;

                    device.state.target_temperature = target_temperature;

                    updateTado( device_data, {
                        setting: {
                            type: "HEATING", 
                            power: "ON", 
                            temperature: { celsius: target_temperature }
                        }, 
                        termination: {type: "MANUAL"}
                    });

                    self.realtime(device_data, 'target_temperature', target_temperature);
                }

                callback( null, device.state.target_temperature );
            }
        },
        measure_temperature: {
            get: function( device_data, callback ) {
                
                var device = devices[ device_data.id ];
                if (typeof device == 'undefined') return callback( new Error("invalid_device") );

                log('[TADO] Capability: Get Measure Temperature (= ' + device.state.measure_temperature + ')');

                callback( null, device.state.measure_temperature );
            }
        },
     	measure_humidity: {
            get: function( device_data, callback ) {
                
                var device = devices[ device_data.id ];
                if (typeof device == 'undefined') return callback( new Error("invalid_device") );

                log('[TADO] Capability: Get Measure Humidity (= ' + device.state.measure_humidity + ')');

                callback( null, device.state.measure_humidity );
            }
	 	}
    },

    pair: function( socket ) {

        log('[TADO] Pairing Init');

        socket.on('start', () => {
            log('[TADO] pairing has started...');

            getAccessToken( function( err, access_token ) {
                if ( err ) log(err);

                newdevice.name                 = 'Tado';
                newdevice.data.id              = 'Tado';
                newdevice.data.access_token    = access_token;

                log('[TADO] Authorized.');

                socket.emit( 'authorized', true );
            });
        });


        var newdevice = {
            name: undefined,
            data: {
                id              : undefined,
                homeid          : undefined,
                zoneid          : '1',
                access_token    : undefined
            }
        };

        /* TODO: multiple Tados/Zones */
        socket.on('list_devices', function( data, callback ) {
            log('[TADO] List devices');
            getHomeId( newdevice, function( error, homeid ) {
                log('[TADO] Adding device');
                newdevice.data.homeid = homeid;
                newdevice.data.zoneid = '1';
                callback( null, [ newdevice ] );
            });
        });

        socket.on('add_device', function( device, callback ) {
            log('[TADO] Add Device');
            log(device);
            initDevice( device.data, function( error ) {
            });
            callback( null, true );
        });

    }
};

function getAccessToken( callback ) {
    var login = Homey.manager('settings').get( 'login' );
    var password = Homey.manager('settings').get( 'password' );

    callback = callback || function(){};

    if (devices.length == 0) {
        log('[TADO] No devices registered');
        return;
    }

    log('[TADO] Getting access token');

    request({
        method: 'POST',
        url: 'https://my.tado.com/oauth/token?client_id=tado-webapp&grant_type=password&scope=home.user&username=' + login + '&password=' + password,
        json : true
    }, function ( err, response, body ) {
        if (err) {
            log(err);
            return callback(err);
        }

        if (debug) {
            log('[TADO-RESPONSE] Getting access token');
            log(body);
        }

        loggedin = true;

        return callback( null, body.access_token );
    });

}


function getHomeId( device, callback ) {
    if (!loggedin) return;
    log('[TADO] Getting home id');
    log(device);

    call({
        path            : '/me',
        access_token    : device.data.access_token
    }, function(err, result, body){
        if (err) return callback(err);

        if (body.homes !== undefined) {
            callback( null, body.homes[0].id);
        }
    });
}

function getState( device_data, callback ) {
    if (!loggedin) return;

    callback = callback || function(){};

    log('[TADO] Getting state (target temp, current temp)');
    log(device_data);

    getStateInternal( device_data, callback );

    getStateExternal( device_data );

}


/*
    Get temperatures provided by Tado device
*/
function getStateInternal( device_data, callback ) {

    call({
        path            : '/homes/' + device_data.homeid + '/zones/' + device_data.zoneid + '/state',
        access_token    : device_data.access_token
    }, function(err, result, body){
        if ( err && callback ) return callback(err);

        if (body.errors !== undefined && body.errors[0].code == 'unauthorized') {
            loggedin = false;
            return;
        }

        var value = null;

        if (body !== undefined) {
            value = _.get(body, 'setting.temperature.celsius');
            if (value !== undefined && value !== null) {
            // set state
                if (devices[ device_data.id ].state.target_temperature != value) {
                    devices[ device_data.id ].state.target_temperature = value;
                    self.realtime( device_data, 'target_temperature', value );
                }
            }

            value = _.get(body, 'sensorDataPoints.insideTemperature.celsius');
            if (value !== undefined && value !== null) {
                if (devices[ device_data.id ].state.measure_temperature != value) {
                    devices[ device_data.id ].state.measure_temperature = value;
                    self.realtime( device_data, 'measure_temperature', value );
                }
            }

            value = _.get(body, 'sensorDataPoints.humidity.percentage');
            if (value !== undefined && value !== null) {
                if (devices[ device_data.id ].state.humidity != value) {
                    devices[ device_data.id ].state.humidity = value;
                    Homey.manager('flow').trigger('humidity', { percentage: value });
                    Homey.manager('insights').createEntry( 'humidity', value, new Date(), function(err, success){
                        if( err ) return Homey.error(err);
                    });
                }
            }
        }

        if (callback) {
            callback(null, devices[ device_data.id ].state);
        }
    });
}

/*
    Get outside temperature, solar intensity & weather state provided by Tado service (via external partners?)
*/
function getStateExternal( device_data, callback ) {

    call({
        path            : '/homes/' + device_data.homeid + '/weather',
        access_token    : device_data.access_token
    }, function(err, result, body){
        if ( err && callback ) return callback(err);

        var value = null, value_rounded = null;

        value = _.get(body, 'outsideTemperature.celsius');
        if (value !== undefined && value !== null) {
        // set state
            value_rounded = Math.round(value * 2) / 2;
            if (devices[ device_data.id ].state.outside_temperature != value) {
                devices[ device_data.id ].state.outside_temperature = value;
                Homey.manager('flow').trigger('outside_temperature', { temperature: value_rounded });
                Homey.manager('insights').createEntry( 'outside_temperature', value, new Date(), function(err, success){
                    if( err ) return Homey.error(err);
                });
            }
        }

        value = _.get(body, 'solarIntensity.percentage');
        if (value !== undefined && value !== null) {
            if (devices[ device_data.id ].state.solar_intensity != value) {
                devices[ device_data.id ].state.solar_intensity = value;
                Homey.manager('flow').trigger('solar_intensity', { intensity: value });
                Homey.manager('insights').createEntry( 'solar_intensity', value, new Date(), function(err, success){
                    if( err ) return Homey.error(err);
                });
            }
        }

        value = _.get(body, 'weatherState.value');
        if (value !== undefined && value !== null) {
            if (devices[ device_data.id ].state.weather_state != value) {
                devices[ device_data.id ].state.weather_state = value;
                Homey.manager('flow').trigger('weather', { state: value });
                Homey.manager('flow').trigger('weather_state', { state: value }, { state: value });
                // RAIN, SUN, NIGHT_CLOUDY, ..
            }
        }

        if (callback) {
            callback(null, devices[ device_data.id ].state);
        }
    });
}

/*
    Initialize a device by creating an object etc
*/
function initDevice( device_data, callback ) {
    log('[TADO] Initializing device');

    devices[ device_data.id ] = {
        id: device_data.id,
        data: device_data,
        state: {
            target_temperature: false,
            measure_temperature: false,
            outside_temperature: false,
            solar_intensity: false,
            weather_state: false
        }   
    };

    Homey.manager('insights').createLog( 'solar_intensity', {
        label: { en: 'Solar Intensity' },
        type: 'number',
        units: { en: '%' },
        decimals: 0
    }, function callback(err , success){
        if( err ) return Homey.error(err);
    });

    Homey.manager('insights').createLog( 'humidity', {
        label: { en: 'Humidity' },
        type: 'number',
        units: { en: '%' },
        decimals: 0
    }, function callback(err , success){
        if( err ) return Homey.error(err);
    });

    Homey.manager('insights').createLog( 'outside_temperature', {
        label: { en: 'Outside Temperature' },
        type: 'number',
        units: { en: '°C' },
        decimals: 1
    }, function callback(err , success){
        if( err ) return Homey.error(err);
    });

    // refresh access token if needed
    getAccessToken( function( err, access_token ) {
        device_data.access_token = access_token;

        // add webhook listener
        registerWebhook( device_data );

        getState( device_data );
    });
}

/*
    Update Tado via their API
*/
function updateTado( device_data, json, callback ) {
    log('[TADO] Setting temp');

    callback = callback || function(){};

    getAccessToken( function( err, access_token ) {
        device_data.access_token = access_token;

        var method = 'PUT';

        if (json == 'DELETE') {
            json = {};
            method = 'DELETE';
        }

        call({
            method          : method,
            path            : '/homes/' + device_data.homeid + '/zones/' + device_data.zoneid + '/overlay',
            access_token    : device_data.access_token,
            json            : json
        }, function(err, result, body){
            if (err) return callback(err);

            devices[ device_data.id ].lastUpdated = new Date();

            callback( null, true );
        });
    });
}

/*
    Make an API call
*/
function call( options, callback ) {
    callback = callback || function(){};

    // create the options object
    options = extend({
        path            : api_url + '/',
        method          : 'GET',
        access_token    : false,
        json            : true
    }, options);


    // remove the first trailing slash, to prevent `.nl//foo`
    if (options.path.charAt(0) === '/') {
        options.path = options.path.substring(1);
    }

    // make the request
    request({
        method: options.method,
        url: api_url + '/' + options.path,
        json: options.json,
        headers: {
            'Authorization': 'Bearer ' + options.access_token
        }
    }, function (err, result, body) {
        log('[TADO-REQUEST] ' + options.method + ' ' + api_url + '/' + options.path);
        log(options.json);
        log('[TADO-RESPONSE] ' + options.path);
        log(body);
        callback(err, result, body);
    });

}

/*
    Listen on a webook
    TODO: test with > 1 devices
*/
function registerWebhook( device_data ) {

    Homey.manager('cloud').registerWebhook(Homey.env.WEBHOOK_ID, Homey.env.WEBHOOK_SECRET, {
        tado_homeid: device_data.homeid,
        tado_zoneid: device_data.zoneid
    }, function onMessage( args ) {

        log("Incoming webhook for Tado", device_data.homeid, args);

        var device = devices[ device_data.homeid ];
        if (typeof device == 'undefined') return callback( new Error("invalid_device") );

        if ( ((new Date()) - device.lastUpdated) < (30 * 1000) ) {
            return log("Ignored webhook, just updated the Thermostat!");
        }

        // TODO: don't do this is just changed value
        if (args.body.target_temperature && args.body.target_temperature != device.state.target_temperature) {
            device.state.target_temperature = args.body.target_temperature;
            self.realtime(device_data, 'target_temperature', device.state.target_temperature);
        }

        if (args.body.room_temperature && args.body.room_temperature != device.state.measure_temperature) {
            device.state.measure_temperature = args.body.room_temperature;
            self.realtime(device_data, 'target_temperature', device.state.measure_temperature);
        }

    }, function callback(){
        log("Webhook registered for Tado", device_data.zoneid);
    });
}

function log( text ) {
    if (debug) {
        Homey.log(text);
    }
}
