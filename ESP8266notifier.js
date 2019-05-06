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

E.setClock(80);                                       // run CPU at 80MHz
const esp = require('ESP8266');                       // ESP8266 methods
const wifi = require('Wifi');                         // Wifi methods
const http = require('http');                         // HTTP methods
const file = require('Storage');                      // Storage methods
let justBooted = true;                                // set if just booted
let data = {};                                        // variables holder
const title = 'ESP8266-Espruino IFTTT Notifier, (c) 2019 Chuck Huffman';

//
// Error flag detection and reporting for more information go to:
// http://www.espruino.com/Reference#l_E_getErrorFlags
//
E.on('errorFlag',(errorFlags) => {
  log("ERROR",errorFlags,1);
});

// on wifi dhcp timeout do the following...
wifi.on('dhcp_timeout', () => (log('WIFI','Wifi DHCP timeout. No connecttion to access point or no IP address acquired.',2)));

// on wifi disconnect do the following...
wifi.on('disconnected', (details) => {
  log('WIFI','Wifi disconnected: '+details.reason,2);
  wifi.connect(data.ssid, {password:data.pswd}, (err) => {
    if (err) {
      log('WIFI','Error during connect. Check password and error message ->'+err,2);
      wifi.disconnect();                              // disconnect
    } else {
      log('WIFI','Wifi connected.',1);
    }
  });
});

//
// load application data from remote file using '.url' info
//
const getData = () => {
  const urlFile = JSON.parse(file.read(".url"));
  let url = urlFile.host+"/"+urlFile.path+"/"+urlFile.file;
  let output = "";

  http.get(url, function(res)  {
    let d = "";                                         // capture reply with d
    res.on('data', function(data) {                     // get data (in reply)
      d+= data;                                         // append to 'd'
    });
    res.on('close', function() {                        // on close process 'd'
    // console.log('Output from callHome: ',d);
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
      wifi.getDetails(),                              // wifi details
      wifi.getIP(),
      data                                            // local IP addr
    ];
    justBooted = false;                               // don't run this again
  } else {
    diag = {
      "Heap": esp.getState().freeHeap,                // ESP8266 mem heap
      "WiFi": wifi.getDetails().rssi,                 // Wifi RSSI dBm
      "IP": wifi.getIP().ip                           // local IP addr
    };
  }
  if (action==1) {                                    // CALL HOME TO IFTTT
    if (wifi.getDetails().status=="connected") {
      callIFTTT(                                      // send data to IFTTT
        data.callHomeEvent,
        data.callHomeEventKey,
        area+" : "+data.device,
        msg,
        diag
      );
    } else {
      console.log(area,'No Wifi - CANNOT contact IFTTT!\n',diag);
    }
  } else if (action==2) {                             // NOTIFY on event
    if (wifi.getDetails().status=="connected") {
      callIFTTT(                                      // send data to IFTTT
        data.eventContact,
        data.eventContactKey,
        data.deviceName,
        msg
      );
    }
  } else if (action==3) {                             // NOTIFY on long event
    if (wifi.getDetails().status=="connected") {
      callIFTTT(                                      // send data to IFTTT
        data.eventLongContact,
        data.eventContactKey,
        data.deviceName,
        msg
      );
    }
  }
  console.log(area,' - ',msg,'\n',diag);              // send to screen
};

//
// Start application when invoked
//
const app = () => {

  clearInterval(dataRetrieval);                       // clear data load loop

  log('INIT',title,1);                                // log start

  // prepare circuit board pin for use
  const contactPin = D4;                              // use pin GPIO4 (D2)
  pinMode(contactPin, "input_pullup");                // set input on board

  //
  // begin monitoring pin contact for change
  //
  const contactWatch = setWatch(() => {
    if (digitalRead(contactPin)===1) {
      log('MON',data.contactMessageOpen,2);
    } else {
      log('MON',data.contactMessageClose,2);
    }
  }, contactPin, {
    repeat: true,                                     // repeat watch function
    debounce: data.eventContactWait                   // wait until active (ms)
  });

  //
  // begin monitoring pin contact for long change
  //
  const contactLongerWatch = setWatch(() => {         // create monitor
    if (digitalRead(contactPin)===1) {
      log('MON',data.contactMessageLongOpen+" (over "+data.eventContactLongWait/1000+" seconds)",3);
    }
  }, contactPin, {
    repeat: true,                                     // repeat watch function
    debounce: data.eventContactLongWait               // wait until active (ms)
  });

  // external LED indicator that app is running
  clearInterval(initLED);                             // clear INIT stage LED
  const appLED = setInterval(() => {
    digitalPulse(D2,false,500);
  }, 60000);

  // regular check-in to log status
  const regularCheck = setInterval(() => {
    log('CHCK','regular check-in',1);
  }, data.callHomeCheckinWait);

  // software check-in for new software
  // const softwareCheck = setInterval(() => {
  //   log('SOFT','software check-in',1);
  // }, data.callHomeSoftwareWait);
};

//
// try to load data specifics from remote server every 10 seconds
//
const dataRetrieval = setInterval(() => {
  console.log('Looking for remote data load...');
  if (data.deviceName) {
    console.log('Data load confirmed. Starting application.');
    app();
  } else {
    getData();
  }
}, 1000);
