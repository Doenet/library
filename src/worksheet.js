import axios from 'axios';
import fingerprint from 'fingerprintjs2';
import hash from 'object-hash';
import { xapiObject } from './xapi/object.js';

import { createPanelElement, setProgressBar } from './panel.js';
import { debounce } from 'underscore';

import { gdprConsent } from './gdpr.js';

import { diff, clone, patch } from 'jsondiffpatch';
import uuidv4 from 'uuid/v4';

//const DIFFSYNC_DEBOUNCE = 5003; // milliseconds to wait to save
const DIFFSYNC_DEBOUNCE = 303; // milliseconds to wait to save
const HEARTBEAT_INTERVAL = 1009; // milliseconds to wait being polling

async function fetchFingerprint() {
  return new Promise((resolve, reject) => {
    if (window.requestIdleCallback) {
      requestIdleCallback(function () {
        fingerprint.get(resolve);
      });
    } else {
      setTimeout(function () {
        fingerprint.get(resolve);
      }, 500);
    }
  });
}

export class Worksheet extends xapiObject {
  constructor(options = {}) {
    super();

    let worksheet = this;

    worksheet.uuid = uuidv4();
    
    if (options.api) {
      worksheet.api = options.api;
    } else {
      worksheet.api = "https://api.doenet.cloud";
    }

    if (options.id) {
      // We are *trusting* the caller here...  We'll end up verifying
      // the same-origin on the iframe side, by comparing this to the
      // origin of our PostMessage
      worksheet.id = options.id;
    } else {
      worksheet.id = window.location.toString();
    }
    
    if (options.title) {
      worksheet.title = options.title;
    } else {
      worksheet.title = document.title;
    }

    worksheet.readyCallbacks = [];
    worksheet.ready = false;
    
    worksheet.progressCallbacks = [];
    worksheet.progress = undefined;

    worksheet.stateCallbacks = [];
    worksheet.shadow = undefined;
    worksheet.database = {};

    worksheet.globalStateCallbacks = [];
    worksheet.globalShadow = undefined;
    worksheet.globalDatabase = {};
    
    worksheet.differentialSynchronization = debounce(worksheet.differentialSynchronizationImmediately.bind(this), DIFFSYNC_DEBOUNCE);
    window.setInterval(worksheet.heartbeat.bind(this), HEARTBEAT_INTERVAL);
    
    let proxyHandler = {
      get(target, property, receiver) {
        const value = Reflect.get(...arguments);
        if (typeof value === 'object') {
          worksheet.differentialSynchronization();
          return new Proxy(value, proxyHandler);
        }
        return value;
      },
      set(target, property, value, receiver) {
        let succeeded = Reflect.set(...arguments);
        if (succeeded) {
          worksheet.differentialSynchronization();
        }
        return succeeded;
      },
      deleteProperty(target, prop) {
        let succeeded = Reflect.deleteProperty(...arguments);
        if (succeeded) {
          worksheet.differentialSynchronization();          
        }
        return succeeded;        
      }
    };
    
    worksheet.state = new Proxy(worksheet.database, proxyHandler);
    worksheet.globalState = new Proxy(worksheet.globalDatabase, proxyHandler);
    
    // not consented to data collection yet...
    worksheet.consent = null;
    gdprConsent( (consent) => {
      // Now the user has affirmatively consented to data collection
      worksheet.consent = consent;
      
      let iframe = createPanelElement(worksheet.api);
      worksheet.contentWindow = iframe.contentWindow;

      // let registered event handlers know about updates
      window.addEventListener("message", function(event) {
        if (event.source == iframe.contentWindow) {
          if (event.data.message === 'setProgress') {
            worksheet.progress = event.data.parameters.score;
            
            setProgressBar( worksheet.progress );
            
            for( const callback of worksheet.progressCallbacks ) {
              callback( event, event.data );
            }
          }

          if (event.data.message === 'setState') {
            let newState = event.data.parameters.state;

            worksheet.shadow = clone( newState );
            worksheet.database = clone( newState );            
            worksheet.state = new Proxy(worksheet.database, proxyHandler);
            
            for( const callback of worksheet.stateCallbacks ) {
              // FIXME: could wrap this in a "make immutable" proxy
              callback( event, worksheet.state );
            }
          }

          if (event.data.message === 'patchState') {
            patch( worksheet.database, event.data.parameters.delta );

	    // Confirm that our shadow now matches their shadow
            if (hash(worksheet.shadow) !== event.data.parameters.checksum) {
              // We are out of sync, and should request synchronization
              worksheet.contentWindow.postMessage( { message: 'getState',
                                                     parameters: { worksheet: worksheet.id,
                                                                   uuid: worksheet.uuid
                                                                 } },
                                                   worksheet.api );
            } else {
              patch( worksheet.shadow, event.data.parameters.delta );
            }
            
            for( const callback of worksheet.stateCallbacks ) {
              // FIXME: could wrap this in a "make immutable" proxy
              callback( event, worksheet.state );
            }
          }

          if (event.data.message === 'setGlobalState') {
            let newState = event.data.parameters.state;

            worksheet.globalShadow = clone( newState );
            worksheet.globalDatabase = clone( newState );            
            worksheet.globalState = new Proxy(worksheet.globalDatabase, proxyHandler);
            
            for( const callback of worksheet.globalStateCallbacks ) {
              // FIXME: could wrap this in a "make immutable" proxy
              callback( event, worksheet.globalState );
            }
          }

          if (event.data.message === 'patchGlobalState') {
            patch( worksheet.globalDatabase, event.data.parameters.delta );

	    // Confirm that our shadow now matches their shadow
            if (hash(worksheet.globalShadow) !== event.data.parameters.checksum) {
              // We are out of sync, and should request synchronization
              worksheet.contentWindow.postMessage( { message: 'getGlobalState',
                                                     parameters: { worksheet: worksheet.id,
                                                                   uuid: worksheet.uuid
                                                                 } },
                                                   worksheet.api );
            } else {
              patch( worksheet.globalShadow, event.data.parameters.delta );
            }
            
            for( const callback of worksheet.globalStateCallbacks ) {
              // FIXME: could wrap this in a "make immutable" proxy
              callback( event, worksheet.globalState );
            }
          }      
          
        }
      }, false);

      // request the current page progress as soon as possible
      iframe.addEventListener("load", function() {
        iframe.contentWindow.postMessage( { message: 'getProgress',
                                            parameters: { worksheet: worksheet.id } },
                                          worksheet.api );

        console.log( "Initial getState and getGlobalState...");

        // get a browser fingerprint which serves as a proxy for a stable userId
        (async function() {
          let fp = await fetchFingerprint();
          worksheet.userId = hash(fp);

          worksheet.ready = true;
          for( const callback of worksheet.readyCallbacks ) {
            callback( {} );
          }
          
          iframe.contentWindow.postMessage( { message: 'getState',
                                              parameters: { worksheet: worksheet.id,
                                                            uuid: worksheet.uuid                                                          
                                                          } },
                                            worksheet.api );
          
          iframe.contentWindow.postMessage( { message: 'getGlobalState',
                                              parameters: { worksheet: worksheet.id,
                                                            uuid: worksheet.uuid                                                          
                                                          } },
                                            worksheet.api );
        })();
      });
    });
    
    return new Proxy(this, {
      set(target, name, value) {
        if (name === 'progress') {
          target.setProgress( value );
          return true;
        } else if (name === 'state') {
          target.database = clone(value);
          target.state = new Proxy(worksheet.database, proxyHandler);
          target.differentialSynchronization();
          return true;
        } else if (name === 'globalState') {
          target.globalDatabase = clone(value);
          target.globalState = new Proxy(worksheet.globalDatabase, proxyHandler);
          target.differentialSynchronization();
          return true;
        } else {
          return Reflect.set(...arguments);
        }
      }
    });
  }
                 
  addEventListener( eventName, callback ) {
    if (eventName == 'progress') {
      callback( {}, this.progress );
      this.progressCallbacks.push( callback );
    }

    if (eventName == 'ready') {
      if (this.ready) {
        callback( {} );
      } else {
        this.readyCallbacks.push( callback );
      }
    }
    
    if (eventName == 'state') {
      this.stateCallbacks.push( callback );
    }

    if (eventName == 'globalState') {
      this.globalStateCallbacks.push( callback );
    }    
  }

  setProgress( score ) {
    this.progress = score;
    
    this.contentWindow.postMessage( { message: 'setProgress',
                                      parameters: { score: this.progress,
                                                    worksheet: this.id,
                                                    title: this.title } },
                                    this.api );
  }

  differentialSynchronizationStatus( status ) {
    console.log("diffsync status:", status);
  }
  
  differentialSynchronizationImmediately() {
    if (this.shadow === undefined) {
      console.log("diffsync: without a shadow, we cannot synchronize.");
    } else {
      console.log("diffsync: diffing shadow and database...");
      let delta = diff( this.shadow, this.database );

      if (delta !== undefined) {
        this.differentialSynchronizationStatus( 'saving' );
        this.contentWindow.postMessage( { message: 'patchState',
                                          parameters: { worksheet: this.id,
                                                        delta: delta,
                                                        uuid: this.uuid,
                                                        checksum: hash(this.shadow)
                                                      } },
                                        this.api );
        
        this.shadow = clone(this.database);
      }
    }

    if (this.globalShadow === undefined) {
      console.log("diffsync: without a global shadow, we cannot synchronize.");
    } else {
      console.log("diffsync: diffing global shadow and database...");
      let delta = diff( this.globalShadow, this.globalDatabase );

      if (delta !== undefined) {
        this.differentialSynchronizationStatus( 'saving' );
        this.contentWindow.postMessage( { message: 'patchGlobalState',
                                          parameters: { worksheet: this.id,
                                                        delta: delta,
                                                        uuid: this.uuid,
                                                        checksum: hash(this.globalShadow)
                                                      } },
                                        this.api );
        
        this.globalShadow = clone(this.globalDatabase);
      }
    }    
    
  }

  heartbeat() {
    if (this.shadow) {
      this.contentWindow.postMessage( { message: 'patchState',
                                        parameters: { worksheet: this.id,
                                                      uuid: this.uuid,
                                                      checksum: hash(this.shadow)
                                                    } },
                                      this.api );
    }

    if (this.globalShadow) {
      this.contentWindow.postMessage( { message: 'patchGlobalState',
                                        parameters: { worksheet: this.id,
                                                      uuid: this.uuid,
                                                      checksum: hash(this.globalShadow)
                                                    } },
                                      this.api );
    }
  }
  
  recordStatement( statement ) {
    this.contentWindow.postMessage( { message: 'recordStatement',
                                      parameters: { worksheet: this.id,
                                                    statement: JSON.stringify(statement.toJSON())
                                                  } },
                                    this.api );
  }
  
  ////////////////////////////////////////////////////////////////
  // Because a worksheet is also an xAPI.Object
  extendStatement( statement ) {
    statement.object = {
      id: this.id,
      definition: {
        name: {
          "en-US": this.title,
        }
      },
      objectType: "Activity"
    };
  }
}
