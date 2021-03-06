/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use stirct";

const { Cc, Ci } = require("chrome");
const { setTimeout } = require("api-utils/timer");
const { Loader, Require, override } = require("test-harness/loader");
const { Worker } = require("api-utils/content/worker");

const DEFAULT_CONTENT_URL = "data:text/html;charset=utf-8,foo";

function makeWindow(contentURL) {
  let content =
    "<?xml version=\"1.0\"?>" +
    "<window " +
    "xmlns=\"http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul\">" +
    "<script>var documentValue=true;</script>" +
    "</window>";
  var url = "data:application/vnd.mozilla.xul+xml;charset=utf-8," +
            encodeURIComponent(content);
  var features = ["chrome", "width=10", "height=10"];

  return Cc["@mozilla.org/embedcomp/window-watcher;1"].
         getService(Ci.nsIWindowWatcher).
         openWindow(null, url, null, features.join(","), null);
}

// Listen for only first one occurence of DOM event
function listenOnce(node, eventName, callback) {
  node.addEventListener(eventName, function onevent(event) {
    node.removeEventListener(eventName, onevent, true);
    callback(node);
  }, true);
}

// Load a given url in a given browser and fires the callback when it is loaded
function loadAndWait(browser, url, callback) {
  listenOnce(browser, "load", callback);
  // We have to wait before calling `loadURI` otherwise, if we call
  // `loadAndWait` during browser load event, the history will be broken
  setTimeout(function () {
    browser.loadURI(url);
  }, 0);
}

// Returns a test function that will automatically open a new chrome window
// with a <browser> element loaded on a given content URL
// The callback receive 3 arguments:
// - test: reference to the jetpack test object
// - browser: a reference to the <browser> xul node
// - done: a callback to call when test is over
function WorkerTest(url, callback) {
  return function testFunction(test) {
    test.waitUntilDone();
    let chromeWindow = makeWindow();
    chromeWindow.addEventListener("load", function onload() {
      chromeWindow.removeEventListener("load", onload, true);
      let browser = chromeWindow.document.createElement("browser");
      browser.setAttribute("type", "content");
      chromeWindow.document.documentElement.appendChild(browser);
      // Wait for about:blank load event ...
      listenOnce(browser, "load", function onAboutBlankLoad() {
        // ... before loading the expected doc and waiting for its load event
        loadAndWait(browser, url, function onDocumentLoaded() {
          callback(test, browser, function onTestDone() {
            chromeWindow.close();
            test.done();
          });
        });
      });
    }, true);
  };
}

exports["test:sample"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {
    
    test.assertNotEqual(browser.contentWindow.location.href, "about:blank",
                        "window is now on the right document");

    let window = browser.contentWindow
    let worker =  Worker({
      window: window,
      contentScript: "new " + function WorkerScope() {
        // window is accessible
        let myLocation = window.location.toString();
        self.on("message", function(data) {
          if (data == "hi!")
            self.postMessage("bye!");
        });
      },
      contentScriptWhen: "ready",
      onMessage: function(msg) {
        test.assertEqual("bye!", msg);
        test.assertEqual(worker.url, window.location.href,
                         "worker.url still works");
        done();
      }
    });

    test.assertEqual(worker.url, window.location.href,
                     "worker.url works");
    worker.postMessage("hi!");
  }
);

exports["test:emit"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {

    let worker =  Worker({
        window: browser.contentWindow,
        contentScript: "new " + function WorkerScope() {
          // Validate self.on and self.emit
          self.port.on("addon-to-content", function (data) {
            self.port.emit("content-to-addon", data);
          });

          // Check for global pollution
          //if (typeof on != "undefined")
          //  self.postMessage("`on` is in globals");
          if (typeof once != "undefined")
            self.postMessage("`once` is in globals");
          if (typeof emit != "undefined")
            self.postMessage("`emit` is in globals");

        },
        onMessage: function(msg) {
          test.fail("Got an unexpected message : "+msg);
        }
      });

    // Validate worker.port
    worker.port.on("content-to-addon", function (data) {
      test.assertEqual(data, "event data");
      done();
    });
    worker.port.emit("addon-to-content", "event data");
  }
);

exports["test:emit hack message"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {
    let worker =  Worker({
        window: browser.contentWindow,
        contentScript: "new " + function WorkerScope() {
          // Validate self.port
          self.port.on("message", function (data) {
            self.port.emit("message", data);
          });
          // We should not receive message on self, but only on self.port
          self.on("message", function (data) {
            self.postMessage("message", data);
          });
        },
        onError: function(e) {
          test.fail("Got exception: "+e);
        }
      });

    worker.port.on("message", function (data) {
      test.assertEqual(data, "event data");
      done();
    });
    worker.on("message", function (data) {
      test.fail("Got an unexpected message : "+msg);
    });
    worker.port.emit("message", "event data");
  }
);

exports["test:n-arguments emit"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {
    let worker =  Worker({
        window: browser.contentWindow,
        contentScript: "new " + function WorkerScope() {
          // Validate self.on and self.emit
          self.port.on("addon-to-content", function (a1, a2, a3) {
            self.port.emit("content-to-addon", a1, a2, a3);
          });
        }
      });

    // Validate worker.port
    worker.port.on("content-to-addon", function (arg1, arg2, arg3) {
      test.assertEqual(arg1, "first argument");
      test.assertEqual(arg2, "second");
      test.assertEqual(arg3, "third");
      done();
    });
    worker.port.emit("addon-to-content", "first argument", "second", "third");
  }
);

exports["test:post-json-values-only"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {

    let worker =  Worker({
        window: browser.contentWindow,
        contentScript: "new " + function WorkerScope() {
          self.on("message", function (message) {
            self.postMessage([ message.fun === undefined,
                               typeof message.w,
                               message.w && "port" in message.w,
                               message.w.url,
                               Array.isArray(message.array),
                               JSON.stringify(message.array)]);
          });
        }
      });

    // Validate worker.onMessage
    let array = [1, 2, 3];
    worker.on("message", function (message) {
      test.assert(message[0], "function becomes undefined");
      test.assertEqual(message[1], "object", "object stays object");
      test.assert(message[2], "object's attributes are enumerable");
      test.assertEqual(message[3], DEFAULT_CONTENT_URL,
                       "jsonable attributes are accessible");
      // See bug 714891, Arrays may be broken over compartements:
      test.assert(message[4], "Array keeps being an array");
      test.assertEqual(message[5], JSON.stringify(array),
                       "Array is correctly serialized");
      done();
    });
    worker.postMessage({ fun: function () {}, w: worker, array: array });
  }
);

exports["test:emit-json-values-only"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {
  
    let worker =  Worker({
        window: browser.contentWindow,
        contentScript: "new " + function WorkerScope() {
          // Validate self.on and self.emit
          self.port.on("addon-to-content", function (fun, w, obj, array) {
            self.port.emit("content-to-addon", [
                            fun === null,
                            typeof w,
                            "port" in w,
                            w.url,
                            "fun" in obj,
                            Object.keys(obj.dom).length,
                            Array.isArray(array),
                            JSON.stringify(array)
                          ]);
          });
        }
      });

    // Validate worker.port
    let array = [1, 2, 3];
    worker.port.on("content-to-addon", function (result) {
      test.assert(result[0], "functions become null");
      test.assertEqual(result[1], "object", "objects stay objects");
      test.assert(result[2], "object's attributes are enumerable");
      test.assertEqual(result[3], DEFAULT_CONTENT_URL,
                       "json attribute is accessible");
      test.assert(!result[4], "function as object attribute is removed");
      test.assertEqual(result[5], 0, "DOM nodes are converted into empty object");
      // See bug 714891, Arrays may be broken over compartments:
      test.assert(result[6], "Array keeps being an array");
      test.assertEqual(result[7], JSON.stringify(array),
                       "Array is correctly serialized");
      done();
    });

    let obj = {
      fun: function () {},
      dom: browser.contentWindow.document.createElement("div")
    };
    worker.port.emit("addon-to-content", function () {}, worker, obj, array);
  }
);

exports["test:content is wrapped"] = WorkerTest(
  "data:text/html;charset=utf-8,<script>var documentValue=true;</script>",
  function(test, browser, done) {

    let worker =  Worker({
      window: browser.contentWindow,
      contentScript: "new " + function WorkerScope() {
        self.postMessage(!window.documentValue);
      },
      contentScriptWhen: "ready",
      onMessage: function(msg) {
        test.assert(msg,
          "content script has a wrapped access to content document");
        done();
      }
    });
  }
);

exports["test:chrome is unwrapped"] = function(test) {
  let window = makeWindow();
  test.waitUntilDone();

  listenOnce(window, "load", function onload() {

    let worker =  Worker({
      window: window,
      contentScript: "new " + function WorkerScope() {
        self.postMessage(window.documentValue);
      },
      contentScriptWhen: "ready",
      onMessage: function(msg) {
        test.assert(msg,
          "content script has an unwrapped access to chrome document");
        window.close();
        test.done();
      }
    });

  });
}

exports["test:nothing is leaked to content script"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {

    let worker =  Worker({
      window: browser.contentWindow,
      contentScript: "new " + function WorkerScope() {
        self.postMessage([
          "ContentWorker" in window,
          "UNWRAP_ACCESS_KEY" in window,
          "getProxyForObject" in window
        ]);
      },
      contentScriptWhen: "ready",
      onMessage: function(list) {
        test.assert(!list[0], "worker API contrustor isn't leaked");
        test.assert(!list[1], "Proxy API stuff isn't leaked 1/2");
        test.assert(!list[2], "Proxy API stuff isn't leaked 2/2");
        done();
      }
    });
  }
);

exports["test:ensure console.xxx works in cs"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {

    // Create a new module loader in order to be able to create a `console`
    // module mockup:
    let loader = Loader(module, {
      console: {
        log: hook.bind("log"),
        info: hook.bind("info"),
        warn: hook.bind("warn"),
        error: hook.bind("error"),
        debug: hook.bind("debug"),
        exception: hook.bind("exception")
      }
    });

    // Intercept all console method calls
    let calls = [];
    function hook(msg) {
      test.assertEqual(this, msg,
                       "console.xxx(\"xxx\"), i.e. message is equal to the " +
                       "console method name we are calling");
      calls.push(msg);
    }

    // Finally, create a worker that will call all console methods
    let worker =  loader.require("content/worker").Worker({
      window: browser.contentWindow,
      contentScript: "new " + function WorkerScope() {
        console.log("log");
        console.info("info");
        console.warn("warn");
        console.error("error");
        console.debug("debug");
        console.exception("exception");
        self.postMessage();
      },
      onMessage: function() {
        // Ensure that console methods are called in the same execution order
        test.assertEqual(JSON.stringify(calls),
                         JSON.stringify(["log", "info", "warn", "error", "debug", "exception"]),
                         "console has been called successfully, in the expected order");
        done();
      }
    });
  }
);


exports["test:setTimeout can\"t be cancelled by content"] = WorkerTest(
  "data:text/html;charset=utf-8,<script>var documentValue=true;</script>",
  function(test, browser, done) {

    let worker =  Worker({
      window: browser.contentWindow,
      contentScript: "new " + function WorkerScope() {
        let id = setTimeout(function () {
          self.postMessage("timeout");
        }, 100);
        unsafeWindow.eval("clearTimeout("+id+");");
      },
      contentScriptWhen: "ready",
      onMessage: function(msg) {
        test.assert(msg,
          "content didn't managed to cancel our setTimeout");
        done();
      }
    });
  }
);

exports["test:setTimeout are unregistered on content unload"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {

    let originalWindow = browser.contentWindow;
    let worker =  Worker({
      window: browser.contentWindow,
      contentScript: "new " + function WorkerScope() {
        document.title = "ok";
        let i = 0;
        setInterval(function () {
          document.title = i++;
        }, 10);
      },
      contentScriptWhen: "ready"
    });

    // Change location so that content script is destroyed,
    // and all setTimeout/setInterval should be unregistered.
    // Wait some cycles in order to execute some intervals.
    setTimeout(function () {
      // Bug 689621: Wait for the new document load so that we are sure that
      // previous document cancelled its intervals
      let url2 = "data:text/html;charset=utf-8,<title>final</title>";
      loadAndWait(browser, url2, function onload() {
        let titleAfterLoad = originalWindow.document.title;
        // Wait additional cycles to verify that intervals are really cancelled
        setTimeout(function () {
          test.assertEqual(browser.contentDocument.title, "final",
                           "New document has not been modified");
          test.assertEqual(originalWindow.document.title, titleAfterLoad,
                           "Nor previous one");

          done();
        }, 100);
      });
    }, 100);
  }
);

exports['test:check window attribute in iframes'] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {

    // Create a first iframe and wait for its loading
    let contentWin = browser.contentWindow;
    let contentDoc = contentWin.document;
    let iframe = contentDoc.createElement("iframe");
    contentDoc.body.appendChild(iframe);

    listenOnce(iframe, "load", function onload() {

      // Create a second iframe inside the first one and wait for its loading
      let iframeDoc = iframe.contentWindow.document;
      let subIframe = iframeDoc.createElement("iframe");
      iframeDoc.body.appendChild(subIframe);

      listenOnce(subIframe, "load", function onload() {
        subIframe.removeEventListener("load", onload, true);

        // And finally create a worker against this second iframe
        let worker =  Worker({
          window: subIframe.contentWindow,
          contentScript: 'new ' + function WorkerScope() {
            self.postMessage([
              window.top !== window,
              frameElement,
              window.parent !== window,
              top.location.href,
              parent.location.href,
            ]);
          },
          onMessage: function(msg) {
            test.assert(msg[0], "window.top != window");
            test.assert(msg[1], "window.frameElement is defined");
            test.assert(msg[2], "window.parent != window");
            test.assertEqual(msg[3], contentWin.location.href,
                             "top.location refers to the toplevel content doc");
            test.assertEqual(msg[4], iframe.contentWindow.location.href,
                             "parent.location refers to the first iframe doc");
            done();
          }
        });

      });
      subIframe.setAttribute("src", "data:text/html;charset=utf-8,bar");

    });
    iframe.setAttribute("src", "data:text/html;charset=utf-8,foo");
  }
);

exports['test:check window attribute in toplevel documents'] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {

    let worker =  Worker({
      window: browser.contentWindow,
      contentScript: 'new ' + function WorkerScope() {
        self.postMessage([
          window.top === window,
          frameElement,
          window.parent === window
        ]);
      },
      onMessage: function(msg) {
        test.assert(msg[0], "window.top == window");
        test.assert(!msg[1], "window.frameElement is null");
        test.assert(msg[2], "window.parent == window");
        done();
      }
    });
  }
);

exports["test:check worker API with page history"] = WorkerTest(
  DEFAULT_CONTENT_URL,
  function(test, browser, done) {
    let url2 = "data:text/html;charset=utf-8,bar";

    loadAndWait(browser, url2, function () {
      let worker =  Worker({
        window: browser.contentWindow,
        contentScript: "new " + function WorkerScope() {
          // Just before the content script is disable, we register a timeout
          // that will be disable until the page gets visible again
          self.on("pagehide", function () {
            setTimeout(function () {
              self.postMessage("timeout restored");
            }, 0);
          });
        },
        contentScriptWhen: "start"
      });

      // postMessage works correctly when the page is visible
      worker.postMessage("ok");

      // We have to wait before going back into history,
      // otherwise `goBack` won't do anything.
      setTimeout(function () {
        browser.goBack();
      }, 0);

      // Wait for the document to be hidden
      browser.addEventListener("pagehide", function onpagehide() {
        browser.removeEventListener("pagehide", onpagehide, false);
        // Now any event sent to this worker should throw
        test.assertRaises(
            function () { worker.postMessage("data"); },
            "The page is currently hidden and can no longer be used until it" +
            " is visible again.",
            "postMessage should throw when the page is hidden in history"
            );
        test.assertRaises(
            function () { worker.port.emit("event"); },
            "The page is currently hidden and can no longer be used until it" +
            " is visible again.",
            "port.emit should throw when the page is hidden in history"
            );

        // Display the page with attached content script back in order to resume
        // its timeout and receive the expected message.
        // We have to delay this in order to not break the history.
        // We delay for a non-zero amount of time in order to ensure that we
        // do not receive the message immediatly, so that the timeout is
        // actually disabled
        setTimeout(function () {
          worker.on("message", function (data) {
            test.assert(data, "timeout restored");
            done();
          });
          browser.goForward();
        }, 500);

      }, false);
    });

  }
);
