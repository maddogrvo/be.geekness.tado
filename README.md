# Tado app for Homey

Unofficial Tado thermostat app for <a href="http://www.athom.nl">Homey</a>.

<span class="badge-paypal"><a href="https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=9JKAQMYRN36EE" title="Donate to this project using Paypal"><img src="https://img.shields.io/badge/paypal-donate-blue.svg" alt="PayPal donate button" /></a></span>

## Configuration

Go to the Homey settings for Tado, and enter your Tado login and password, this is the same account you use to access https://my.tado.com. This data is only saved locally on your Homey, and not shared with either me or Athom.


## How does it work

The Tado Homey app uses the unofficial my.tado.com API, and does not directly communicate with your Tado device. All data is sent over https, via https://my.tado.com.


## Flow

### Triggers (device)

- The temperature changed (temperature token, in increments of 0.5 °C)

- The target temperature changed (temperature token)


### Triggers (app)

- Weather state changed to ... (state token)

- Weather changed (state token, different values: RAIN, CLEAR, NIGHT_CLOUDY, CLOUDY_PARTLY, THUNDERSTORMS, SUN, WINDY, etc.) (1)

- Solar intensity changed (intensity token, value in percentage [0..100])

- Outside temperature changed (temperature token, in increments of 0.5 °C)

- [0.5.1] Humidity changed (percent token, value in percentage [0..100]). NOTE: Not available in first generation Tado devices, which were used in the alpha & beta phases.


### Conditions (app)

- [0.5.1] Weather state is ... (dropdown with known weather states)


### Actions (device)

- Set the temperature (enable manual mode)


### Actions (app)

- [0.5.1] Set heating to auto

- [0.5.1] Turn heating off (frost protection enabled)


## Todo

- Support for multiple zones, e.g. multiple Tado Heating devices, or Heating & Cooling devices

- Ability to use Tado's presence detection within Homey's flow

- Trigger / Condition for when Tado switches between HOME / AWAY / SLEEP


## Changelog

- 0.5.7 Fix for a regression, better handling of Tado API key existence via lodash get()

- 0.5.6 Fix for Tado web API change (getAccessToken)

- 0.5.5 Possible fix for the humidity insight (thanks to ZperX)

- 0.5.4 Quick bugfix for new installations

- 0.5.3 More bugfixes: fix humidity insight, fix pairing issue, fix loss of card values after Homey/app restarts

- 0.5.2 Bugfixes and compatibility update

- 0.5.1 New actions, triggers and conditions

- 0.5.0 Initial stable version


## Bugs & Features

If you find a bug, please use the Github Issue system for this repository to submit the details of your bug report.

If you would like to have a new feature implemented, use the Github Issue system to submit your feature request.

## Contributions

- mauriceb for the additional extensive my.tado.com API information

- ZperX for a possible solution with the humidity insight


## Legal

This is an unofficial Tado app, built by/for the Homey community. The app is provided "as is", without warranty of any kind.



