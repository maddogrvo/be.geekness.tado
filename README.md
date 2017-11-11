# Tado app for Homey

Unofficial Tado thermostat app for <a href="http://www.athom.nl">Homey</a>.

UPDATE, November 2017, v0.7.0: Fixed, rewritten and upgraded by Alex van den Berg (OpenMind_NL).
Because the app uses the unofficial tado API, you might experience some problems whenever tado changes their API without a notice in advance. However, this is not expected to happen often. In general you may experience a more or less flawless operation when there is a good internet connection.

NOTE, October 2017, v0.6.1: This app was taken over by Athom on request of the developer. Only a small fix was made to enable users to authenticate with the Tado API again.


## Configuration

* Go to the Homey settings page for tado Heating.
* Enter the same details that you use to access https://my.tado.com. This data is only saved locally on your Homey and will only be used for secure communication with my.tado.com. Nothing is shared with the developers or Athom.
* Enter the "tado secret" (More info at settings). 

* Go to "Zones & Devices" and add as many "tado Heating zone" devices as you have in your account.
* On each "Heating zone" device click the little wrench and set your desired zone number. Zone numbers are shown in the URL (address bar) when you visit a Zone at https://my.tado.com with your web browser.
* That's it!


## How does it work
The app communicates with the unofficial my.tado.com API, and does not directly contact your tado devices. All data is sent over https, via https://my.tado.com.

Various items are available in the mobile app:
* Thermostat dial. Only 0.5 degree steps for now, but we're working on the 0.1 degree resolution that tado offers for their Smart Thermostats.
* Button: Set zone to Smart Heating.
* Displays:
  * Temperature
  * Heating power (%)
  * Humidity
  * Open Window detection
  * Smart Heating activity
  * Temperature outside (Offered by tado, from external provider)
  * Solar intensity (Offered by tado, from external provider)
  * Weather conditions (Offered by tado, from external provider)


### Flow Triggers (zone device)
* The temperature setting has changed (with temperature token)
* The temperature measurement has changed (temperature token)
* The humidity has changed (percentage token)
* The heating power has changed (percentage token)
* Open Window Detection has changed (detection token: true or false)
* Smart Heating has changed (active token: true or false)

- NOTE: Humidity may not be available for the first generation tado devices, which were used in the alpha & beta phases.


### Flow Triggers (tado app-device)
* Outside temperature has changed (temperature token)
* Solar intensity has changed (intensity (%) token)
* The Weather changes (conditions token: [Sunny, Foggy, Thunderstorms etc.], id token: internally used id for comparisons etc.)
* Weather state changes to... [Select from currently known possibilities] (id token)


### Flow Conditions (tado app-device)
* Weather state is/is not... [Select from currently known possibilities]


### Flow Actions (zone device)
* Set the temperature (enable manual mode, only 0.5 degree steps for now. We're working on 0.1 degree resolution)
* Activate Smart Heating
* Turn heating off


## NOT AVAILABLE (yet?):
* Support for realtime update. Now you can select to refresh every 30 sec, up to an hour.
* Support for other tado devices. (Airco control, Hot water)
* Support for tado's presence detection, including Flow Trigger and Condition for the presence status. (HOME / AWAY / SLEEP)


## Changelog

### 0.7.0
  * Update/make-over bij Alex van den Berg (OpenMind_NL). Adding multiple zone control, extended mobile display and various bug fixes.

### 0.6.1
  * On request of the original developer, Athom takes over and repairs log-in for some users.

--------------- Pre-Athom. Developer Hellhound ---------------

### 0.5.7
  * Fix for a regression
  * Better handling of Tado API key existence via lodash get()
  * Added option to download logs (via settings)

### 0.5.6
  * Fix for Tado web API change (getAccessToken)

### 0.5.5
  * Possible fix for the humidity insight (thanks to ZperX)

### 0.5.4
  * Quick bugfix for new installations

### 0.5.3
  * More bugfixes: fix humidity insight, fix pairing issue, fix loss of card values after Homey/app restarts

### 0.5.2
  * Bugfixes
  * Compatibility update

### 0.5.1
  * New actions, triggers and conditions

### 0.5.0
  * Initial stable version


## Contributions
* Alex van den Berg: First contribution v0.7.0
* Hellhound: Took the original initiative and built the first versions.
* mauriceb: Additional extensive my.tado.com API information
* ZperX: Possible solution with the Insights


## Legal

This is an unofficial Tado app, built by and for the Homey community. The app is provided "as is", without warranty of any kind.
