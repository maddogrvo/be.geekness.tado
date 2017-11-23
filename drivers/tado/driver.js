"use strict";

var devices  = {},
    tado_ZoneData           = {}, // future use.
    tado_updateTime         = { value:60 },
    tado_updateInterval     = null, // refresh/update devices interval id
    weather_updateTime      = { value:900 },
    weather_updateInterval  = null, // refresh/update weather interval id
    log_homeid              = undefined;

var _        = require('lodash');
var path     = require('path');
var request  = require('request');
var extend   = require('util')._extend;
var log4js   = require('log4js');
var fs       = require('fs');
var logfile  = 'userdata/tado.log';
var debug    = false;
var loggedin = false;
var terminationType = 'TADO_MODE';

var BASE_URL = 'https://my.tado.com/api/v2';
var AUTH_URL = 'https://auth.tado.com';

//log4js.loadAppender('file');
//log4js.addAppender(log4js.appenders.file(logfile), 'tado');

if (fs.existsSync(logfile)) {
    fs.unlink(logfile);
}
log4js.configure({
  appenders: [
    { type: 'console' },
    {
      type: 'file',
      filename: 'userdata/tado.log',
      "maxLogSize": 200000,
      category: 'tado'
    }
  ]
});
var logger   = log4js.getLogger('tado');

var self = module.exports = {

    init: function( devices_data, callback ) {
        getAccessToken( function( err, access_token ) {
          if (access_token == null) {
              logger.debug("[TADO-INIT] No access token available");
              return false;
          }

          getHomeIdByAccessToken( access_token, function( error, homeid ) {
            // init exisiting devices
            devices_data.forEach( function( device_data ){
              initDevice( device_data );
              // get zone_id from settings
              module.exports.getSettings( device_data, function( err, settings ){
                devices[device_data.id].access_token = access_token;
                devices[device_data.id].homeid = homeid;
                devices[device_data.id].zoneid = settings.zone_id;
                getState( device_data, callback );
              });
            });
          });
        });

        // set & run update interval
        function setUpdateInterval(sec){
          clearInterval(tado_updateInterval);
          tado_updateInterval = setInterval(function(){
              addLogItem('Interval: Checking for data changes on tado server');

              getAccessToken( function( err, access_token ) {
                  if (access_token == null) {
                      logger.error("[TADO-RECURRING] No access token available, not executing recurring tasks (temporarily)");
                      return false;
                  }

                  for (var device_id in devices) {
                      devices[device_id].access_token = access_token;
                      getState( devices[device_id].data, callback );
                  }
              });
          }, 1000 * sec);
        }

        // get and init settings
        tado_updateTime = Homey.manager('settings').get('updateTime');
        //weather_updateTime = Homey.manager('settings').get('weatherTime');
        if(tado_updateTime === undefined){tado_updateTime = {value: 60}; }
        //if(weather_updateTime === undefined){weather_updateTime = {value: 900}; }
        setUpdateInterval(tado_updateTime.value);
        //setWeatherInterval(weather_updateTime.value);
		terminationType = Homey.manager('settings').get('terminationType').value;
		console.log(terminationType);
		
        Homey.manager('settings').on('set', function (setting) {
        	switch(setting){
				case 'updateTime':
					tado_updateTime = Homey.manager('settings').get('updateTime');
					setUpdateInterval(tado_updateTime.value);
					addLogItem('Devices update interval time set to ' + tado_updateTime.value + ' sec.');
        		break;
				case 'terminationType':
					terminationType = Homey.manager('settings').get('terminationType').value;
					console.log(terminationType);
				break;
/*
          case 'debug':
        		debug = Homey.manager('settings').get('debug');
            switch(debug){
              case '0':
              console.log('Full log off');
              if (fs.existsSync(logfile)) { fs.unlink(logfile); }
              break;

              case '1':
                console.log('Full log on');
                break;
            }
            break;
            */
        	}
        });


        // on flow triggers
        Homey.manager('flow').on('trigger.weather_state', function( callback, args, state ) {
            if ( args.current_state == state.state ) {
                callback( null, true );
            } else {
                callback( null, false );
            }
        });

        // on flow conditions
        Homey.manager('flow').on('condition.weather_state', function( callback, args ) {
            if (devices[0] !== undefined) {
                if ( args.current_state == devices[0].state.weather_state ) {
                    callback( null, true );
                    return;
                }
            }
            callback( null, false );
        });

        // on flow actions
        Homey.manager('flow').on('action.set_auto', function( callback, args, state ){
            //console.log(args); // { 'my_arg': 'bar', 'device': { id: 'blahblah' } }, this is the user input + device data
            //console.log(state); // { 'my_state': 'bar' }, this is the state parameter, as passed in trigger()
            if (devices[args.device.id].data) {
              updateTado( devices[args.device.id].data, 'DELETE');
              addLogItem('Setting Smart heating for zone ' + devices[args.device.id].zoneid );
            }
            callback( null, true );
        });

        Homey.manager('flow').on('action.set_off', function( callback, args, state ){
            if (devices[args.device.id].data) {
              updateTado( devices[args.device.id].data, {
                setting: {
                    type: "HEATING",
                    power: "OFF",
                },
                termination: {type: terminationType}
              });
            }
            callback( null, true );
        });

        if (devices_data.length === 0) {
            callback();
        }
    },

    deleted: function( device_data ) {
        addLogItem('Deleting device Tado ' + device_data.id + ' (zone ' + devices[ device_data.id ].zoneid + ' controller)');
        delete devices[ device_data.id ];
    },

    capabilities: {
        target_temperature: {
            get: function( device_data, callback ){

                var device = getDeviceByData( device_data );
                if( device instanceof Error ) return callback( device );
                addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Target Temperature (= ' + device.state.target_temperature + ')');

                callback( null, device.state.target_temperature );
            },
            set: function( device_data, target_temperature, callback ){
                if (!loggedin) return callback( new Error("no_session") );
                var device = getDeviceByData( device_data );
                if( device instanceof Error ) return callback( device );

                // temporary until Homey step-0.1-thermostat bug has been fixed (v1.5.6?)
                target_temperature = Math.round( Number( target_temperature ) / 0.5) * 0.5;

                addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Set Target Temperature to ' + target_temperature);
                // update online if different
                if (target_temperature != device.state.target_temperature) {
                    device.state.target_temperature = target_temperature;
                    updateTado( device_data, {
                        setting: {
                            type: "HEATING",
                            power: "ON",
                            temperature: { celsius: target_temperature }
                        },
                        termination: {type: terminationType}
                    });
                    self.realtime(device_data, 'target_temperature', target_temperature);
                    self.realtime(device_data, 'smart_heating', false);
                    setTimeout(function(){
                      getState( device_data, callback );
                    }, 5000);
                    //getState( device_data, callback );
                }
                callback( null, device.state.target_temperature );
            }
        },

        measure_temperature: {
            inside: {
                get: function( device_data, callback ) {
                    var device = getDeviceByData( device_data );
                    if( device instanceof Error ) return callback( device );

                    addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Measure Temperature (= ' + device.state.measure_temperature.inside + ')');

                    callback( null, device.state.measure_temperature.inside );
                }
            },
            outside: {
                get: function( device_data, callback ) {
                    var device = getDeviceByData( device_data );
                    if( device instanceof Error ) return callback( device );

                    addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Measure Temperature Outside (= ' + device.state.measure_temperature.outside + ')');

                    callback( null, device.state.measure_temperature.outside );
                }
            }
        },
       	measure_humidity: {
              get: function( device_data, callback ) {
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );

                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Measure Humidity (= ' + device.state.measure_humidity + ')');

                  callback( null, device.state.measure_humidity );
              }
  	 	  },
       	solar_intensity: {
              get: function( device_data, callback ) {
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );

                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Solar intensity (= ' + device.state.solar_intensity + ')');

                  callback( null, device.state.solar_intensity );
              }
  	 	  },
       	heating_power: {
              get: function( device_data, callback ) {
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );

                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Heating power (= ' + device.state.heating_power + ')');

                  callback( null, device.state.heating_power );
              }
  	 	  },
       	detect_open_window: {
              get: function( device_data, callback ) {
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );

                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Open Window detection (= ' + device.state.detect_open_window + ')');

                  callback( null, device.state.detect_open_window );
              }
  	 	  },
       	smart_heating: {
              get: function( device_data, callback ) {
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );

                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Smart heating setting (= ' + device.state.smart_heating + ')');

                  callback( null, device.state.smart_heating );
              },
              set: function( device_data, smart_heating, callback ){
                  if (!loggedin) return callback( new Error("no_session") );
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );
                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Set Smart heating to ' + smart_heating);

                  // update online if different
                  if (smart_heating != device.state.smart_heating) {
                      device.state.smart_heating = smart_heating;
                      switch(smart_heating){
                        case true:
                          updateTado( device_data, 'DELETE');
                          setTimeout(function(){
                            getState( device_data, callback );
                          }, 5000);
                          addLogItem('Activating Smart heating for zone ' + device.zoneid );
                          break;
                      }
                      self.realtime(device_data, 'smart_heating', smart_heating);
                  }
                  callback( null, device.state.smart_heating );
              }
  	 	  },
       	weather_state: {
              get: function( device_data, callback ) {
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );

                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get Weather Condition (= ' + device.state.weather_state + ')');

                  callback( null, device.state.weather_state );
              }
  	 	  },
       	dummy_mobile: {
              get: function( device_data, callback ) {
                  var device = getDeviceByData( device_data );
                  if( device instanceof Error ) return callback( device );

                  addLogItem('Capability for zone ' + devices[ device_data.id ].zoneid + ': Get dummy_mobile');

                  callback( null, device.state.dummy_mobile );
              }
  	 	  }

    },

    pair: function( socket ) {
        addLogItem('Pairing Init');


        var uniqueId = 'tado_' + (new Date()).getTime().toString(16);
        var newdevice = getNewDeviceObject();
        newdevice.name = __("settings.txt_heating_zone");
        newdevice.data.id = uniqueId;

        socket.on('start', () => {
            addLogItem('pairing has started...');

            getAccessToken( function( err, access_token ) {
                if ( err ){
                  logger.debug (err);
                }
                if(access_token != null) {
                  newdevice.access_token = access_token;
                  addLogItem('Authorized.');
                  socket.emit( 'authorized', true );
                }
            });
        });

        /* TODO: multiple Tados/Zones */
        socket.on('list_devices', function( data, callback ) {
            addLogItem('List devices');

          getAccessToken( function( err, access_token ) {
              if ( err ) logger.debug (err);
              for (var device_id in devices) {
                  devices[device_id].access_token = access_token;
                  getState( devices[device_id].data, callback );
              }
            //getWeather( callback );
          });

          getHomeId( newdevice, function( error, homeid ) {
              if ( error ) logger.debug(error);
              addLogItem('Adding device');
              newdevice.homeid = homeid;
              callback( null, [ newdevice ] );
          });
        });

        socket.on('add_device', function( device, callback ) {
            addLogItem('Add Device');
            addDevice( device, function( error ) {
            });
            callback( null, true );
        });

    },
    settings: function( device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback ) {
      switch(changedKeysArr[0]){
        case 'zone_id':
          var device = getDeviceByData( device_data );
          addLogItem('Zone number changed from ' + device.zoneid + ' to ' + newSettingsObj.zone_id );
          device.zoneid = newSettingsObj.zone_id;

          // refresh access_token & capabilities for all devices
          getAccessToken( function( err, access_token ) {
            if (access_token == null) {
                logger.debug("No access token available to refresh capabilities after zone change");
                return false;
            }
            for (var device_id in devices) {
                devices[device_id].access_token = access_token;
                getState( devices[device_id].data, callback );
            }

          });
          break;
      }
      callback( null, true );
    }
};

// a helper method to get a device from the devices list by it's device_data object
function getDeviceByData( device_data ) {
    var device = devices[ device_data.id ];
    if( typeof device === 'undefined' ) {
        return new Error("invalid_device");
    } else {
        return device;
    }
}

// a helper method to add a device to the devices list
function initDevice( device_data ) {
  devices[ device_data.id ] = getNewDeviceObject();
  devices[ device_data.id ].data = device_data;
}

function getNewDeviceObject(){
    return {
        id              : undefined,
        data: {
            id          : undefined
        },
        state           : {
            target_temperature: 0,
            measure_temperature: {
              inside: 0,
              outside: 0
            },
            heating_power: 0,
            measure_humidity: 0,
            detect_open_window: false,
            smart_heating: false,
            solar_intensity: 0,
            weather_state: "cloudy"
        },
        name : '',
        access_token : undefined,
        zoneid : 1,
        homeid : undefined
    };
}


function getAccessToken( callback ) {
    var login = Homey.manager('settings').get( 'login' ),
        password = Homey.manager('settings').get( 'password' ),
        tado_secret = Homey.manager('settings').get( 'tado_secret' ),
        access_token = null;

    callback = callback || function(){};

    if (devices.length == 0) {
        logger.warn('No devices registered');
        return;
    }

    addLogItem('Request access token');
    request({
        method: 'POST',
        url: `${AUTH_URL}/oauth/token?client_id=tado-web-app&client_secret=${tado_secret}&grant_type=password&scope=home.user&username=${login}&password=${password}`,
        json : true
    }, function ( err, response, body ) {
        if (err) {
            logger.debug(err);
            return callback(err);
        }

        addLogItem('[TADO-RESPONSE] Receiving access token');
        loggedin = true;

        if (body != undefined) {
            access_token = body.access_token;
        }
        return callback( null, access_token );
    });

}



function getHomeIdByAccessToken( tado_access_token, callback ) {
    if (!loggedin) return;
    addLogItem('Getting home id');

    call({
        path            : '/me',
        access_token    : tado_access_token
    }, function(err, result, body){
        if (err) return callback(err);

        //console.log('getHomeIdByAccessToken');
        //console.log(body);

        if (body.homes !== undefined) {
            log_homeid = body.homes[0].id;
            callback( null, body.homes[0].id);
        }
    });
}

function getHomeId( device, callback ) {
    if (!loggedin) return;
    addLogItem('Getting home id');

    call({
        path            : '/me',
        access_token    : device.access_token
    }, function(err, result, body){
        if (err) return callback(err);

        if (body.homes !== undefined) {
            log_homeid = body.homes[0].id;
            callback( null, body.homes[0].id);
        }
    });
}

function getTadoZones( device_data, callback ){

    var device = getDeviceByData( device_data );
    call({
        path            : '/homes/' +  device.homeid + '/zones',
        access_token    : device.access_token
    }, function(err, result, body){
        if ( err && callback ) return callback(err);

//console.log('getTadoZones');
//console.log(body);

        tado_ZoneData = {};
        body.forEach(function(item, index) {
          tado_ZoneData[item.id] = item;

/*
          console.log('Zone ' + item.id + ':');
          console.log(tado_ZoneData[item.id].deviceTypes);
          console.log(tado_ZoneData[item.id].devices);
          tado_ZoneData[item.id].devices.forEach(function( devitem, devindex ){
            console.log('Device ' + devitem.serialNo + ' characteristics:');
            console.log( devitem.characteristics);
          });
*/

        });


        if (callback) {
            callback(null, tado_ZoneData);
        }
    });
}


function getState( device_data, callback ) {
    if (!loggedin) return;
    callback = callback || function(){};

    getTadoZones( device_data, callback )
    getStateInternal( device_data, callback );

    getStateExternal( device_data );
}

/* Get internal data provided by tado device */
function getStateInternal( device_data, callback ) {

    var device = getDeviceByData( device_data );
    call({
        path            : '/homes/' + device.homeid + '/zones/' + device.zoneid + '/state',
        access_token    : device.access_token
    }, function(err, result, body){
        if ( err && callback ) return callback(err);

        if (body.errors !== undefined && body.errors[0].code == 'unauthorized') {
            loggedin = false;
            return;
        }

        var value = null;

        if (body !== undefined && devices[ device_data.id ] !== undefined) {
console.log('');
console.log('getStateInternal');
console.log(body);
console.log('');

            // target temperature setting in zone
            value = _.get(body, 'setting.temperature.celsius');
            if (value !== undefined && value !== null) {
              //value = Number( value );
              // temporary until Homey bug for 0.1 is solved (v1.5.6?)
              value = Math.round( Number( value ) / 0.5) * 0.5;
              if (devices[ device_data.id ].state.target_temperature != value) {
                  devices[ device_data.id ].state.target_temperature = value;
                  self.realtime( device_data, 'target_temperature', value );
                  addLogItem("Trigger Target Temperature flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                  Homey.manager('flow').triggerDevice( 'target_temperature', { temperature: value }, null, device_data);
              }
            }

            // temperature measurement in zone
            value = _.get(body, 'sensorDataPoints.insideTemperature.celsius');
            if (value !== undefined && value !== null) {
                value = Math.round( 10 * Number( value ) ) / 10;
                if (devices[ device_data.id ].state.measure_temperature.inside != value) {
                    devices[ device_data.id ].state.measure_temperature.inside = value;
                    self.realtime( device_data, 'measure_temperature.inside', value );
                    addLogItem("Trigger Temperature flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                    Homey.manager('flow').triggerDevice('inside_temperature', { temperature: value }, null, device_data);
                }
            }

            // humidity measurement in zone
            value = _.get(body, 'sensorDataPoints.humidity.percentage');
            if (value !== undefined && value !== null) {
                value = Math.round( Number( value ) );
                if (devices[ device_data.id ].state.measure_humidity != value) {
                    devices[ device_data.id ].state.measure_humidity = value;
                    self.realtime( device_data, 'measure_humidity', value );
                    addLogItem("Trigger Humidity flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                    Homey.manager('flow').triggerDevice('humidity', { percentage: value }, null, device_data);
                }
            }

            // Heating power measurement in zone
            value = _.get(body, 'activityDataPoints.heatingPower.percentage');
            if (value !== undefined && value !== null) {
                value = Math.round( Number( value ) );
                if (devices[ device_data.id ].state.heating_power != value) {
                    devices[ device_data.id ].state.heating_power = value;
                    self.realtime( device_data, 'heating_power', value );
                    addLogItem("Trigger Heating Power flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                    Homey.manager('flow').triggerDevice('heating_power', { percentage: value }, null, device_data);
                }
            }

            // Open window detection in zone
            value = _.get(body, 'openWindow');
            if (value !== undefined) {
                if( value == 'null' || value == null){
                  value = false;
                } else {
                  value = true;
                }
                if (devices[ device_data.id ].state.detect_open_window != value) {
                    devices[ device_data.id ].state.detect_open_window = value;
                    self.realtime( device_data, 'detect_open_window', value );
                    addLogItem("Trigger Open Window Detection flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                    Homey.manager('flow').triggerDevice('detect_open_window', { detection: value }, null, device_data);
                }
            }

            // Smart heating on/off detection
            value = _.get(body, 'overlayType');
            if (value !== undefined) {
                if( value == 'null' || value == null){
                  value = true; // overlayType = null. smart heating activated
                } else {
                  value = false; // overlayType = 'MANUAL'.
                }
                if (devices[ device_data.id ].state.smart_heating != value) {
                    devices[ device_data.id ].state.smart_heating = value;
                    self.realtime( device_data, 'smart_heating', value );
                    addLogItem("Trigger Smart Heating flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                    Homey.manager('flow').triggerDevice('smart_heating', { detection: value }, null, device_data);
                }
            }
        }

        if (callback) {
            callback(null, devices[ device_data.id ].state);
        }
    });
}

/* Get outside temperature, solar intensity & weather state provided by Tado service via external partner */
function getStateExternal(  device_data, callback ) {

    var device = getDeviceByData( device_data );

    call({
        path            : '/homes/' + device.homeid + '/weather',
        access_token    : device.access_token
    }, function(err, result, body){
        if ( err && callback ) return callback(err);

        var value = null;

        if (body !== undefined && devices[ device_data.id ] !== undefined) {
//console.log('getStateExternal');
//console.log(body);

            // temperature outside, according to tado webservice
            value = Number( _.get(body, 'outsideTemperature.celsius') );
            if (value !== undefined && value !== null) {
                value = Math.round( 10 * Number( value ) ) / 10;
                if (devices[ device_data.id ].state.outside_temperature != value) {
                    devices[ device_data.id ].state.outside_temperature = value;
                    self.realtime( device_data, 'measure_temperature.outside', value );

                    addLogItem("Trigger Outside Temperature flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                    Homey.manager('flow').trigger('outside_temperature', { temperature: value });
              }
            }

            // solar intensity, according to tado webservice
            value = Number( _.get(body, 'solarIntensity.percentage') );
            if (value !== undefined && value !== null) {
                if (devices[ device_data.id ].state.solar_intensity != value) {
                    devices[ device_data.id ].state.solar_intensity = value;
                    self.realtime( device_data, 'solar_intensity', value );

                    addLogItem("Trigger Solar Intensity flows for zone " + devices[ device_data.id ].zoneid + " with value: " + value);
                    Homey.manager('flow').trigger('solar_intensity', { intensity: value });
                }
            }

            // weather condition, according to tado webservice
            value = _.get(body, 'weatherState.value');
            if (value !== undefined && value !== null) {
                value = value.toLowerCase();
                if (devices[ device_data.id ].state.weather_state != value) {
                    devices[ device_data.id ].state.weather_state = value;
                    self.realtime( device_data, 'weather_state', value );

                    var txtvalue = __("settings." + value );
                    addLogItem("Trigger Weather State flows for zone " + devices[ device_data.id ].zoneid + " with state: " + value );
                    Homey.manager('flow').trigger('weather', { condition: txtvalue, state: value });
                    Homey.manager('flow').trigger('weather_state', { state: value }, { state: value });

                    // log possible unknown weatherState
                    var knownState = [
                          "night_clear", "night_cloudy",
                          "cloudy", "cloudy_mostly", "cloudy_partly",
                          "foggy", "drizzle", "scattered_rain", "rain", "snow", // snow = expected to exist
                          "thunderstorms", "sun", "windy"
                        ],
                        newState = true;
                    knownState.forEach( function(item){
                       if(item == value){ newState = false; }
                    });
                    if(newState){ logger.debug("Unknown weatherState detected: " + value); }
                }
            }

            if (callback) {
                callback(null, devices[ device_data.id ].state);
            }
        }
    });
}

/* Add a device by creating an object etc */
function addDevice( device, callback ) {
    addLogItem('Initializing device');

    var device_data = device.data,
        xAccess = device.access_token,
        xZone = device.zoneid,
        xHome = device.homeid,
        xName = device.name;

    initDevice( device_data );
    devices[device_data.id].access_token = xAccess;
    devices[device_data.id].zoneid = xZone;
    devices[device_data.id].name = xName;
    devices[device_data.id].homeid = xHome;

    module.exports.setSettings( devices[device_data.id].data, {
        zone_id: xZone
    }, function( err, settings ){
        logger.debug('error: ' + settings + '\n\r' + err)
    });

    // refresh access token and get capabilitiy states
    getAccessToken( function( err, access_token ) {
        devices[ device_data.id ].access_token = access_token;
        getState( device_data, callback );
    });
}

/*  Update tado target temperature online via API */
function updateTado( device_data, json, callback ) {
    addLogItem('Updating target temperature for zone ' + devices[ device_data.id ].zoneid + ' to ' + (devices[ device_data.id ].state.target_temperature) );

    callback = callback || function(){};

    getAccessToken( function( err, access_token ) {
        if (access_token == null) {
            logger.debug("[TADO-UPDATE] No access token available. Server update not possible");
            callback( null, true );
            return false;
        }

        devices[ device_data.id ].access_token = access_token;

        var method = 'PUT';

        if (json == 'DELETE') {
            json = {};
            method = 'DELETE';
        }

        var device = getDeviceByData( device_data );
        call({
            method          : method,
            path            : '/homes/' + device.homeid + '/zones/' + device.zoneid + '/overlay',
            access_token    : devices[ device_data.id ].access_token,
            json            : json
        }, function(err, result, body){
            if (err) return callback(err);

            devices[ device_data.id ].lastUpdated = new Date();

            callback( null, true );
        });
    });
}



// ***** tado API call
function call( options, callback ) {
    callback = callback || function(){};

    // create the options object
    options = extend({
        path            : BASE_URL + '/',
        method          : 'GET',
        access_token    : false,
        json            : true
    }, options);


    // remove the first trailing slash, to prevent `.nl//foo`
    if (options.path.charAt(0) === '/') {
        options.path = options.path.substring(1);
    }

    addLogItem('[TADO-REQUEST] ' + options.method + ' ' + BASE_URL + '/' + options.path);
    // make the request
    request({
        method: options.method,
        url: BASE_URL + '/' + options.path,
        json: options.json,
        headers: {
            'Authorization': 'Bearer ' + options.access_token
        }
    }, function (err, result, body) {
        addLogItem('[TADO-RESPONSE] ' + options.path);
        callback(err, result, body);
    });

}

/*
    Listen on a webook
    TODO: test with > 1 devices
*/
function registerWebhook( device_data ) {

    Homey.manager('cloud').registerWebhook(Homey.env.WEBHOOK_ID, Homey.env.WEBHOOK_SECRET, {
      tado_homeid: devices[ device_data.id ].homeid,
      //tado_homeid: device_data.homeid,
      tado_zoneid: devices[ device_data.id ].zoneid
      //tado_zoneid: device_data.zoneid
    }, function onMessage( args ) {

        addLogItem("Incoming webhook for Tado " + devices[ device_data.id ].homeid + '\n\r' + args);

        var device = devices[ device_data.id ].homeid;
        if (typeof device == 'undefined') return callback( new Error("invalid_device") );

        if ( ((new Date()) - device.lastUpdated) < (30 * 1000) ) {
            return addLogItem("Ignored webhook, just updated the Thermostat!");
        }

        // TODO: don't do this is just changed value
        if (args.body.target_temperature && args.body.target_temperature != device.state.target_temperature) {
            device.state.target_temperature = args.body.target_temperature;
            self.realtime(device_data, 'target_temperature', device.state.target_temperature);
        }

        if (args.body.room_temperature && args.body.room_temperature != device.state.measure_temperature.inside) {
            device.state.measure_temperature.inside = args.body.room_temperature;
            self.realtime(device_data, 'measure_temperature.inside', device.state.measure_temperature.inside);
        }

    }, function callback(){
        addLogItem("Webhook registered for Tado zone " +  devices[ device_data.id ].zoneid);
    });
}



function addLogItem( ltext ) {
    if(debug){
      if(log_homeid !== undefined){
        while( ltext.indexOf(log_homeid) > -1) { ltext = ltext.replace(log_homeid, '*private*'); }
      }
      logger.debug( ltext );
    } else {
      console.log(ltext);
    }
}

function deleteLog() {
    if (fs.existsSync(logfile)) {
        fs.unlink(logfile);
    }
}
