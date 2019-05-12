//
// ESP8266 Notifier
// ESP8266 board running ESP8266_Espruino firmware
//
// Chuck Huffman - 20190427
//
// ESP8266notifier.js
//

console.log('Starting ESP8266 Notifier...');

// flash LED every second during file loading and wait period
const initLED = setInterval(() => {
  digitalPulse(D2,false,500);
}, 1000);

// get methods and variables declared
E.setClock(80);                                       // run CPU at 80MHz
const esp = require('ESP8266');                       // ESP8266 methods
const wifi = require('Wifi');                         // Wifi methods
const http = require('http');                         // HTTP methods
const file = require('Storage');                      // Storage methods
let justBooted = true;                                // set if just booted
let falseTrigger = 0;                                 // track false events
let data = {};                                        // variables holder
const title = 'ESP8266-Espruino IFTTT Notifier, (c) 2019 Chuck Huffman';

//
// load application data from remote file using '.url' info
//
const getData = () => {
  const urlFile = JSON.parse(file.read(".url"));
  let url = urlFile.host+"/"+urlFile.path+"/"+urlFile.file;
  let output = "";

  http.get(url, function(res)  {
    let d = "";                                       // capture reply with d
    res.on('data', function(data) {                   // get data (in reply)
      d+= data;                                       // append to 'd'
    });
    res.on('close', function() {                      // on close process 'd'
      output = JSON.parse(d);
      data = {
        device: getSerial(),
        callHomeName: output.messages.callHomeName,
        callHomeEvent: output.logging.iftttEvent,
        callHomeEventKey: output.logging.iftttKey,
        callHomeCheckinWait: output.logging.regularCheckInWait,
        callHomeSoftwareWait: output.logging.softwareCheckWait,
        deviceName: output.messages.deviceName,
        eventContact: output.ifttt.eventContact,
        eventLongContact: output.ifttt.eventLongContact,
        eventContactKey: output.ifttt.eventContactKey,
        eventContactWait: output.timers.contactWait,
        eventContactLongWait: output.timers.contactLongWait,
        contactMessageOpen: output.messages.eventContactOpen,
        contactMessageClose: output.messages.eventContactClosed,
        contactMessageLongOpen: output.messages.eventLongContactOpen,
        contactMessageLongClose: output.messages.eventLongContactClosed
      };
    });
  });
};

//
// IFTTT calling function
//
const callIFTTT = (eventType,key,v1,v2,v3) => {

  const content = JSON.stringify({                    // convert to JSON
    "value1":v1,                                      // v1 info
    "value2":v2,                                      // v2 message
    "value3":v3                                       // v3 detail
  });

  const options = {                                   // prep url & headers
    host: 'maker.ifttt.com',
    port: 80,
    path: '/trigger/'+eventType+'/with/key/'+key,
    method: 'POST',
    headers: {
      "Content-Type":"application/json",
      "Content-Length":content.length
    }
  };

  http.request(options, function(res)  {              // make http call
    let d = "";                                       // capture reply with d
    res.on('data', function(data) {                   // get data (reply)
      d+= data;
    });
    res.on('close', function() {                      // on close show reply
      console.log("HTTP connection closed: "+d);
    });
  }).end(content);                                    // content for request
};

//
// Logging function to screen or IFTTT
//
const log = (area, msg, action) => {
  let diag = '';
  if (justBooted) {                                   // msg if just booted
    diag = [
      esp.getState(),                                 // state of ESP8266
      esp.getResetInfo(),                             // ESP8266 reset info
      process.memory(),                               // get memory details
      wifi.getDetails(),                              // wifi details
      wifi.getIP(),
      "Falses: "+falseTrigger,                        // report false events
      data                                            // local IP addr
    ];
    justBooted = false;                               // don't run this again
  } else {
    diag = {
      "Heap": esp.getState().freeHeap,                // ESP8266 mem heap
      "Mem": process.memory(),                        // get memory details
      "WiFi": wifi.getDetails().rssi,                 // Wifi RSSI dBm
      "IP": wifi.getIP().ip,                          // local IP addr
      "Falses": falseTrigger                          // report false triggers
    };
  }

  // take action based on logging flag passed in
  switch (action) {

    case 1:
      callIFTTT(                                      // call home via IFTTT
        data.callHomeEvent,
        data.callHomeEventKey,
        area+" - "+data.deviceName+" - "+data.device,
        msg,
        diag
      );
    break;

    case 2:
      callIFTTT(                                      // notify of event 2
        data.eventContact,
        data.eventContactKey,
        data.deviceName,
        msg
      );
    break;

    case 3:
      callIFTTT(                                      // notify of event 3
        data.eventLongContact,
        data.eventContactKey,
        data.deviceName,
        msg
      );
    break;

    case 4:
      callIFTTT(                                      // call home via IFTTT
        data.callHomeEvent,
        data.callHomeEventKey,
        area+" : "+data.device,
        msg,
        diag
      );

      callIFTTT(                                      // notify of event 2
        data.eventContact,
        data.eventContactKey,
        data.deviceName,
        msg
      );
    break;
  }
  console.log(area,' - ',msg,'\n',diag);              // send to screen
};

//
// Error flag detection and reporting for more information go to:
// http://www.espruino.com/Reference#l_E_getErrorFlags
//
E.on('errorFlag',(errorFlags) => {
  log("ERROR",errorFlags,4);
});

// on wifi dhcp timeout do the following...
wifi.on('dhcp_timeout', () => (log('WIFI','Wifi DHCP timeout. No connecttion to access point or no IP address acquired.',4)));

// on wifi disconnect do the following...
wifi.on('disconnected', (details) => {
  log('WIFI','Wifi disconnected: '+details.reason,4);
  wifi.connect(data.ssid, {password:data.pswd}, (err) => {
    if (err) {
      log('WIFI','Error during connect. Check password and error message ->'+err,4);
      wifi.disconnect();                              // disconnect
    } else {
      log('WIFI','Wifi connected.',4);
    }
  });
});

//
// Start application when invoked
//
const app = () => {

  clearInterval(dataRetrieval);                       // clear data load loop

  log('INIT',title,4);                                // log start

  // prepare circuit board pin for use
  const contactPin = D4;                              // use pin GPIO4 (D2)
  pinMode(contactPin, "input_pullup");                // set input on board
  let pinState = digitalRead(contactPin);             // set pinState

  //
  // act on pin contact change from setWatch functions
  //
  const contactCheck = (checkType, pin) => {          // check event
    if (checkType==="short") {                        // short duraton event
      if (pin===1 && pinState===0) {                  // if diff than old state
        log('MON',data.contactMessageOpen,2);         // call logging
        pinState = 1;                                 // invert pin state
      } else if (pin===0 && pinState===1) {
        log('MON',data.contactMessageClose,2);
        pinState = 0;
      } else {                                        // record false trigger
        falseTrigger = falseTrigger + 1;              // if no event match
      }
    } else {
      if (pin===1 && pinState===1) {                  // long duration event
        log('MON',data.contactMessageLongOpen+" (over "+data.eventContactLongWait/1000+" seconds)",3);
      }
    }
  };

  //
  // begin monitoring pin contact for change
  //
  const contactWatch = setWatch(() => {
    contactCheck('short',digitalRead(contactPin));
  }, contactPin, {
    repeat: true,                                     // repeat watch function
    debounce: data.eventContactWait                   // wait to run (ms)
  });

  //
  // begin monitoring pin contact for long change
  //
  const contactLongerWatch = setWatch(() => {         // create monitor
    contactCheck('long',digitalRead(contactPin));
  }, contactPin, {
    repeat: true,                                     // repeat watch function
    debounce: data.eventContactLongWait               // wait to run (ms)
  });

  // external LED indicator that app is running
  clearInterval(initLED);                             // clear INIT stage LED
  const appLED = setInterval(() => {
    digitalPulse(D2,false,500);
  }, 60000);

  // regular check-in to log status
  const regularCheck = setInterval(() => {            // check in function
    log('CHCK','regular check-in',1);
  }, data.callHomeCheckinWait);

  // software check-in for new software               // software update check
  // const softwareCheck = setInterval(() => {
  //   log('SOFT','software check-in',1);
  // }, data.callHomeSoftwareWait);
};

//
// try to load data specifics from remote server every 10 seconds
//
const dataRetrieval = setInterval(() => {
  console.log('Looking for remote data...');
  if (data.deviceName) {
    console.log('Data loading confirmed. Starting application.');
    app();
  } else {
    getData();
  }
}, 10000);
