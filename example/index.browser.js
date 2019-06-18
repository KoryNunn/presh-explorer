(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
(function (global){
var EventEmitter = require('events').EventEmitter,
    isInstance = require('is-instance');

function createPool(growSize, create, dispose){
    var pool = [];
    var index = -1;
    var totalCreated = 0;
    var totalDisposed = 0;

    return {
        size: function(){
            return pool.length;
        },
        created: function(){
            return totalCreated;
        },
        disposed: function(){
            return totalDisposed;
        },
        get: function(){
            if(index >= 0){
                var item = pool[index];
                pool[index] = null;
                index--;
                return item;
            }

            totalCreated++;
            return create();
        },
        dispose: function(object){
            totalDisposed++;
            dispose(object);
            if(index >= pool.length){
                pool = pool.concat(new Array(growSize));
            }
            index++;
            pool[index] = object;
        }
    }
}

var setPool = createPool(1000, function(){
    return new Set();
}, function(set){
    set.clear();
});

var emitKeyPool = createPool(10, function(){
    return new Map();
}, function(emitKey){
    emitKey.forEach(setPool.dispose);
    emitKey.clear();
});

function toArray(items){
    return Array.prototype.slice.call(items);
}

var deepRegex = /[|.]/i;

function matchDeep(path){
    return (path + '').match(deepRegex);
}

function isWildcardPath(path){
    var stringPath = (path + '');
    return ~stringPath.indexOf('*');
}

function getTargetKey(path){
    var stringPath = (path + '');
    return stringPath.split('|').shift();
}

var eventSystemVersion = 1,
    globalKey = '_entiEventState' + eventSystemVersion,
    globalState = global[globalKey] = global[globalKey] || {
        instances: [],
        getPoolInfo: function(){
            return [
                'setPool', setPool.size(),
                'created', setPool.created(),
                'disposed', setPool.disposed(),
                'emitKeyPool', emitKeyPool.size(),
                'created', emitKeyPool.created(),
                'disposed', emitKeyPool.disposed()
            ];
        }
    };

var modifiedEnties = globalState.modifiedEnties_v6 = globalState.modifiedEnties_v6 || setPool.get(),
    trackedObjects = globalState.trackedObjects_v6 = globalState.trackedObjects_v6 || new WeakMap();
    trackedHandlers = globalState.trackedHandlers_v6 = globalState.trackedHandlers_v6 || new WeakMap();

function leftAndRest(path){
    var stringPath = (path + '');

    // Special case when you want to filter on self (.)
    if(stringPath.slice(0,2) === '.|'){
        return ['.', stringPath.slice(2)];
    }

    var match = matchDeep(stringPath);
    if(match){
        return [stringPath.slice(0, match.index), stringPath.slice(match.index+1)];
    }
    return stringPath;
}

function isWildcardKey(key){
    return key.charAt(0) === '*';
}

function isFeralcardKey(key){
    return key === '**';
}

function addHandler(object, key, handler, parentHandler){
    var trackedKeys = trackedObjects.get(object);
    var trackedHandler = trackedHandlers.get(parentHandler);

    if(trackedKeys == null){
        trackedKeys = {};
        trackedObjects.set(object, trackedKeys);
    }
    if(trackedHandler == null){
        trackedHandler = new WeakMap();
        trackedHandlers.set(parentHandler, new WeakMap());
    }

    if(trackedHandler.get(object) == null){
        trackedHandler.set(object, setPool.get());
    }

    if(trackedHandler.get(object).has(key)){
        return;
    }

    var handlers = trackedKeys[key];

    if(!handlers){
        handlers = setPool.get();
        trackedKeys[key] = handlers;
    }

    handlers.add(handler);
    trackedHandler.get(object).add(key);
}

function removeHandler(object, key, handler, parentHandler){
    var trackedKeys = trackedObjects.get(object);
    var trackedHandler = trackedHandlers.get(parentHandler);

    if(
        trackedKeys == null ||
        trackedHandler == null ||
        trackedHandler.get(object) == null ||
        !trackedHandler.get(object).has(key)
    ){
        return;
    }

    var handlers = trackedKeys[key];

    if(!handlers){
        return;
    }

    handlers.delete(handler);
    if(handlers.size === 0){
        setPool.dispose(handlers);
        delete trackedKeys[key];
    }
    var trackedObjectHandlerSet = trackedHandler.get(object);
    trackedObjectHandlerSet.delete(key);
    if(trackedObjectHandlerSet.size === 0){
        setPool.dispose(trackedObjectHandlerSet);
        trackedHandler.delete(object);
    }
}

function trackObjects(eventName, tracked, handler, object, key, path){
    if(!object || typeof object !== 'object'){
        return;
    }

    var target = object[key];

    if(target && typeof target === 'object' && tracked.has(target)){
        return;
    }

    trackObject(eventName, tracked, handler, object, key, path);
}

function trackKeys(eventName, tracked, handler, target, root, rest){
    var keys = Object.keys(target);
    for(var i = 0; i < keys.length; i++){
        if(isFeralcardKey(root)){
            trackObjects(eventName, tracked, handler, target, keys[i], '**' + (rest ? '.' : '') + (rest || ''));
        }else{
            trackObjects(eventName, tracked, handler, target, keys[i], rest);
        }
    }
}

function trackObject(eventName, tracked, handler, object, key, path){
    var eventKey = key === '**' ? '*' : key,
        target = object[key],
        targetIsObject = target && typeof target === 'object';

    var handle = function(event, emitKey){
        if(eventKey !== '*' && typeof object[eventKey] === 'object' && object[eventKey] !== target){
            if(targetIsObject){
                tracked.delete(target);
            }
            removeHandler(object, eventKey, handle, handler);
            trackObjects(eventName, tracked, handler, object, key, path);
            return;
        }

        if(eventKey === '*'){
            trackKeys(eventName, tracked, handler, object, key, path);
        }

        if(!tracked.has(object)){
            return;
        }

        if(key !== '**' || !path){
            handler(event, emitKey);
        }
    };

    addHandler(object, eventKey, handle, handler);

    if(!targetIsObject){
        return;
    }

    tracked.add(target);

    if(!path){
        return;
    }

    var rootAndRest = leftAndRest(path),
        root,
        rest;

    if(!Array.isArray(rootAndRest)){
        root = rootAndRest;
    }else{
        root = rootAndRest[0];
        rest = rootAndRest[1];

        // If the root is '.', watch for events on *
        if(root === '.'){
            root = '*';
        }
    }

    if(targetIsObject && isWildcardKey(root)){
        trackKeys(eventName, tracked, handler, target, root, rest);
    }

    trackObjects(eventName, tracked, handler, target, root, rest);
}

function emitForEnti(trackedPaths, trackedObjectPaths, eventName, emitKey, event, enti){
    var emitSet = emitKey.get(eventName);
    if(!emitSet){
        emitSet = setPool.get();
        emitKey.set(eventName, emitSet);
    }

    if(emitSet.has(enti)){
        return;
    }

    if(!trackedPaths.trackedObjects.has(enti._model)){
        trackedPaths.entis.delete(enti);
        if(trackedPaths.entis.size === 0){
            delete trackedObjectPaths[eventName];
        }
        return;
    }

    emitSet.add(enti);

    var targetKey = getTargetKey(eventName),
        value = isWildcardPath(targetKey) ? undefined : enti.get(targetKey);

    enti.emit(eventName, value, event);
}

var trackedEvents = new WeakMap();
function createHandler(enti, trackedObjectPaths, trackedPaths, eventName){
    return function(event, emitKey){
        trackedPaths.entis.forEach(emitForEnti.bind(null, trackedPaths, trackedObjectPaths, eventName, emitKey, event));
    };
}

var internalEvents = ['newListener', 'attach', 'detached', 'destroy'];
function isInternalEvent(enti, eventName){
    return ~internalEvents.indexOf(eventName) &&
        enti._events &&
        enti._events[eventName] &&
        (!Array.isArray(enti._events[eventName]) || enti._events[eventName].length === 1);
}

function trackPath(enti, eventName){
    if(isInternalEvent(enti, eventName)){
        return;
    }

    var object = enti._model,
        trackedObjectPaths = trackedEvents.get(object);

    if(!trackedObjectPaths){
        trackedObjectPaths = {};
        trackedEvents.set(object, trackedObjectPaths);
    }

    var trackedPaths = trackedObjectPaths[eventName];

    if(!trackedPaths){
        trackedPaths = {
            entis: setPool.get(),
            trackedObjects: new WeakSet()
        };
        trackedObjectPaths[eventName] = trackedPaths;
    }else if(trackedPaths.entis.has(enti)){
        return;
    }

    trackedPaths.entis.add(enti);

    var handler = createHandler(enti, trackedObjectPaths, trackedPaths, eventName);

    trackObjects(eventName, trackedPaths.trackedObjects, handler, {model:object}, 'model', eventName);
}

function trackPaths(enti){
    if(!enti._events || !enti._model){
        return;
    }

    for(var key in enti._events){
        trackPath(enti, key);
    }
    modifiedEnties.delete(enti);
}

function emitEvent(object, key, value, emitKey){

    modifiedEnties.forEach(trackPaths);

    var trackedKeys = trackedObjects.get(object);

    if(!trackedKeys){
        return;
    }

    var event = {
        value: value,
        key: key,
        object: object
    };

    function emitForKey(handler){
        handler(event, emitKey);
    }

    if(trackedKeys[key]){
        trackedKeys[key].forEach(emitForKey);
    }

    if(trackedKeys['*']){
        trackedKeys['*'].forEach(emitForKey);
    }
}

function emit(events){
    var emitKey = emitKeyPool.get();

    events.forEach(function(event){
        emitEvent(event[0], event[1], event[2], emitKey);
    });

    emitKeyPool.dispose(emitKey);
}

function onNewListener(){
    modifiedEnties.add(this);
}

function modelRemove(model, events, key){
    if(Array.isArray(model)){
        model.splice(key, 1);
        events.push([model, 'length', model.length]);
    }else{
        delete model[key];
        events.push([model, key]);
    }
}

function Enti(model){
    var detached = model === false;

    if(!model || (typeof model !== 'object' && typeof model !== 'function')){
        model = {};
    }

    if(detached){
        this._model = {};
    }else{
        this.attach(model);
    }

    this.on('newListener', onNewListener);
}
Enti.emit = function(model, key, value){
    if(!(typeof model === 'object' || typeof model === 'function')){
        return;
    }

    emit([[model, key, value]]);
};
Enti.get = function(model, key){
    if(!model || typeof model !== 'object'){
        return;
    }

    key = getTargetKey(key);

    if(key === '.'){
        return model;
    }


    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.get(model[path[0]], path[1]);
    }

    return model[key];
};
Enti.set = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    key = getTargetKey(key);

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.set(model[path[0]], path[1], value);
    }

    var original = model[key];

    if(typeof value !== 'object' && value === original){
        return;
    }

    var keysChanged = !(key in model);

    model[key] = value;

    var events = [[model, key, value]];

    if(keysChanged){
        if(Array.isArray(model)){
            events.push([model, 'length', model.length]);
        }
    }

    emit(events);
};
Enti.push = function(model, key, value){
    if(!model || typeof model !== 'object'){
        return;
    }

    var target;
    if(arguments.length < 3){
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.push(model[path[0]], path[1], value);
        }

        target = model[key];
    }

    if(!Array.isArray(target)){
        throw new Error('The target is not an array.');
    }

    target.push(value);

    var events = [
        [target, target.length-1, value],
        [target, 'length', target.length]
    ];

    emit(events);
};
Enti.insert = function(model, key, value, index){
    if(!model || typeof model !== 'object'){
        return;
    }


    var target;
    if(arguments.length < 4){
        index = value;
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.insert(model[path[0]], path[1], value, index);
        }

        target = model[key];
    }

    if(!Array.isArray(target)){
        throw new Error('The target is not an array.');
    }

    target.splice(index, 0, value);

    var events = [
        [target, index, value],
        [target, 'length', target.length]
    ];

    emit(events);
};
Enti.remove = function(model, key, subKey){
    if(!model || typeof model !== 'object'){
        return;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.remove(model[path[0]], path[1], subKey);
    }

    // Remove a key off of an object at 'key'
    if(subKey != null){
        Enti.remove(model[key], subKey);
        return;
    }

    if(key === '.'){
        throw new Error('. (self) is not a valid key to remove');
    }

    var events = [];

    modelRemove(model, events, key);

    emit(events);
};
Enti.move = function(model, key, index){
    if(!model || typeof model !== 'object'){
        return;
    }

    var path = leftAndRest(key);
    if(Array.isArray(path)){
        return Enti.move(model[path[0]], path[1], index);
    }

    if(key === index){
        return;
    }

    if(!Array.isArray(model)){
        throw new Error('The model is not an array.');
    }

    var item = model[key];

    model.splice(key, 1);

    model.splice(index - (index > key ? 0 : 1), 0, item);

    emit([[model, index, item]]);
};
Enti.update = function(model, key, value, options){
    if(!model || typeof model !== 'object'){
        return;
    }

    var target,
        isArray = Array.isArray(value);

    var events = [],
        updatedObjects = new WeakSet();

    if(typeof key === 'object'){
        options = value;
        value = key;
        key = '.';
        target = model;
    }else{
        var path = leftAndRest(key);
        if(Array.isArray(path)){
            return Enti.update(model[path[0]], path[1], value);
        }

        if(!(key in model)){
            model[key] = isArray ? [] : {};
            events.push([model, key, target]);
        }

        target = model[key];
    }

    if(typeof value !== 'object'){
        throw new Error('The value is not an object.');
    }

    if(typeof target !== 'object'){
        throw new Error('The target is not an object.');
    }

    function updateTarget(target, value){
        for(var key in value){
            var currentValue = target[key];
            if(currentValue instanceof Object && !updatedObjects.has(currentValue) && !(currentValue instanceof Date)){
                updatedObjects.add(currentValue);
                updateTarget(currentValue, value[key]);
                continue;
            }
            target[key] = value[key];
            events.push([target, key, value[key]]);
        }

        if(options && options.strategy === 'morph'){
            for(var key in target){
                if(!(key in value)){
                    modelRemove(target, events, key);
                }
            }
        }

        if(Array.isArray(target)){
            events.push([target, 'length', target.length]);
        }
    }

    updateTarget(target, value);

    emit(events);
};
Enti.prototype = Object.create(EventEmitter.prototype);
Enti.prototype._maxListeners = 1000;
Enti.prototype.constructor = Enti;
Enti.prototype.attach = function(model){
    if(this._model === model){
        return;
    }

    this.detach();

    if(model && !isInstance(model)){
        throw new Error('Entis may only be attached to an object, or null/undefined');
    }

    modifiedEnties.add(this);
    this._attached = true;
    this._model = model;
    this.emit('attach', model);
};
Enti.prototype.detach = function(){
    if(!this._attached){
        return;
    }
    modifiedEnties.delete(this);

    this._model = {};
    this._attached = false;
    this.emit('detach');
};
Enti.prototype.destroy = function(){
    this.detach();
    this.emit('destroy');
    this._events = undefined;
};
Enti.prototype.get = function(key){
    return Enti.get(this._model, key);
};

Enti.prototype.set = function(key, value){
    return Enti.set(this._model, key, value);
};

Enti.prototype.push = function(key, value){
    return Enti.push.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.insert = function(key, value, index){
    return Enti.insert.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.remove = function(key, subKey){
    return Enti.remove.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.move = function(key, index){
    return Enti.move.apply(null, [this._model].concat(toArray(arguments)));
};

Enti.prototype.update = function(key, index){
    return Enti.update.apply(null, [this._model].concat(toArray(arguments)));
};
Enti.prototype.isAttached = function(){
    return this._attached;
};
Enti.prototype.attachedCount = function(){
    return modifiedEnties.size;
};

Enti.isEnti = function(target){
    return target && !!~globalState.instances.indexOf(target.constructor);
};

Enti.store = function(target, key, value){
    if(arguments.length < 2){
        return Enti.get(target, key);
    }

    Enti.set(target, key, value);
};

globalState.instances.push(Enti);

module.exports = Enti;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"events":11,"is-instance":2}],2:[function(require,module,exports){
module.exports = function(value){
    return value && typeof value === 'object' || typeof value === 'function';
};
},{}],3:[function(require,module,exports){
var explorer = require('../')({
    resultTransform: (result, token) => {
        return typeof result === 'number' ? result.toFixed(2) : result
    },
    nodeAction: (event, component, scope, token) => {
        if(token.type === 'number'){
            return;
        }

        event.stopPropagation();
        var active = component.element.classList.contains('active')
        if(active){
            component.element.classList.remove('active')
        } else {
            component.element.classList.add('active')
        }
    }
})

explorer.source(`
math.min(
    (
        1 / 12 *
        bar + add(2 4 / foo)
    ) / foo
    true ? 2 : 3
)
`)
var defaultGlobals = {
    add: (a, b) => a + b,
    foo: 4
};
explorer.globals(defaultGlobals)

window.addEventListener('load', function(){
    document.body.appendChild(explorer.element)
})

setInterval(function(){
    explorer.globals({
        ...defaultGlobals,
        foo: Math.round(Math.random() * 10),
        bar: Math.round(Math.random() * 10)
    })
}, 100);
},{"../":4}],4:[function(require,module,exports){
var fastn = require('fastn')(require('fastn/domComponents')({
    preshExplorer: require('./preshExplorerComponent')
}));

module.exports = function(settings){
    if(!settings || !(settings instanceof Object)){
        settings = {}
    }

    return fastn('preshExplorer', settings)
        .attach()
        .render()
};
},{"./preshExplorerComponent":45,"fastn":19,"fastn/domComponents":15}],5:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  for (var i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(
      uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)
    ))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}

},{}],6:[function(require,module,exports){
(function (Buffer){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species != null &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

}).call(this,require("buffer").Buffer)

},{"base64-js":5,"buffer":6,"ieee754":28}],7:[function(require,module,exports){
module.exports = function(element){
    var lastClasses = [];

    return function(classes){

        if(!arguments.length){
            return lastClasses.join(' ');
        }

        function cleanClassName(result, className){
            if(typeof className === 'string' && className.match(/\s/)){
                className = className.split(' ');
            }

            if(Array.isArray(className)){
                return result.concat(className.reduce(cleanClassName, []));
            }

            if(className != null && className !== '' && typeof className !== 'boolean'){
                result.push(String(className).trim());
            }

            return result;
        }

        var newClasses = cleanClassName([], classes),
            currentClasses = element.className ? element.className.split(' ') : [];

        lastClasses.map(function(className){
            if(!className){
                return;
            }

            var index = currentClasses.indexOf(className);

            if(~index){
                currentClasses.splice(index, 1);
            }
        });

        if(lastClasses.join() === newClasses.join()){
            return;
        }

        currentClasses = currentClasses.concat(newClasses);
        lastClasses = newClasses;

        element.className = currentClasses.join(' ');
    };
};

},{}],8:[function(require,module,exports){
(function (Buffer){
var clone = (function() {
'use strict';

/**
 * Clones (copies) an Object using deep copying.
 *
 * This function supports circular references by default, but if you are certain
 * there are no circular references in your object, you can save some CPU time
 * by calling clone(obj, false).
 *
 * Caution: if `circular` is false and `parent` contains circular references,
 * your program may enter an infinite loop and crash.
 *
 * @param `parent` - the object to be cloned
 * @param `circular` - set to true if the object to be cloned may contain
 *    circular references. (optional - true by default)
 * @param `depth` - set to a number if the object is only to be cloned to
 *    a particular depth. (optional - defaults to Infinity)
 * @param `prototype` - sets the prototype to be used when cloning an object.
 *    (optional - defaults to parent prototype).
*/
function clone(parent, circular, depth, prototype) {
  var filter;
  if (typeof circular === 'object') {
    depth = circular.depth;
    prototype = circular.prototype;
    filter = circular.filter;
    circular = circular.circular
  }
  // maintain two arrays for circular references, where corresponding parents
  // and children have the same index
  var allParents = [];
  var allChildren = [];

  var useBuffer = typeof Buffer != 'undefined';

  if (typeof circular == 'undefined')
    circular = true;

  if (typeof depth == 'undefined')
    depth = Infinity;

  // recurse this function so we don't reset allParents and allChildren
  function _clone(parent, depth) {
    // cloning null always returns null
    if (parent === null)
      return null;

    if (depth == 0)
      return parent;

    var child;
    var proto;
    if (typeof parent != 'object') {
      return parent;
    }

    if (clone.__isArray(parent)) {
      child = [];
    } else if (clone.__isRegExp(parent)) {
      child = new RegExp(parent.source, __getRegExpFlags(parent));
      if (parent.lastIndex) child.lastIndex = parent.lastIndex;
    } else if (clone.__isDate(parent)) {
      child = new Date(parent.getTime());
    } else if (useBuffer && Buffer.isBuffer(parent)) {
      if (Buffer.allocUnsafe) {
        // Node.js >= 4.5.0
        child = Buffer.allocUnsafe(parent.length);
      } else {
        // Older Node.js versions
        child = new Buffer(parent.length);
      }
      parent.copy(child);
      return child;
    } else {
      if (typeof prototype == 'undefined') {
        proto = Object.getPrototypeOf(parent);
        child = Object.create(proto);
      }
      else {
        child = Object.create(prototype);
        proto = prototype;
      }
    }

    if (circular) {
      var index = allParents.indexOf(parent);

      if (index != -1) {
        return allChildren[index];
      }
      allParents.push(parent);
      allChildren.push(child);
    }

    for (var i in parent) {
      var attrs;
      if (proto) {
        attrs = Object.getOwnPropertyDescriptor(proto, i);
      }

      if (attrs && attrs.set == null) {
        continue;
      }
      child[i] = _clone(parent[i], depth - 1);
    }

    return child;
  }

  return _clone(parent, depth);
}

/**
 * Simple flat clone using prototype, accepts only objects, usefull for property
 * override on FLAT configuration object (no nested props).
 *
 * USE WITH CAUTION! This may not behave as you wish if you do not know how this
 * works.
 */
clone.clonePrototype = function clonePrototype(parent) {
  if (parent === null)
    return null;

  var c = function () {};
  c.prototype = parent;
  return new c();
};

// private utility functions

function __objToStr(o) {
  return Object.prototype.toString.call(o);
};
clone.__objToStr = __objToStr;

function __isDate(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Date]';
};
clone.__isDate = __isDate;

function __isArray(o) {
  return typeof o === 'object' && __objToStr(o) === '[object Array]';
};
clone.__isArray = __isArray;

function __isRegExp(o) {
  return typeof o === 'object' && __objToStr(o) === '[object RegExp]';
};
clone.__isRegExp = __isRegExp;

function __getRegExpFlags(re) {
  var flags = '';
  if (re.global) flags += 'g';
  if (re.ignoreCase) flags += 'i';
  if (re.multiline) flags += 'm';
  return flags;
};
clone.__getRegExpFlags = __getRegExpFlags;

return clone;
})();

if (typeof module === 'object' && module.exports) {
  module.exports = clone;
}

}).call(this,require("buffer").Buffer)

},{"buffer":6}],9:[function(require,module,exports){
//Copyright (C) 2012 Kory Nunn

//Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

//The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/*

    This code is not formatted for readability, but rather run-speed and to assist compilers.

    However, the code's intention should be transparent.

    *** IE SUPPORT ***

    If you require this library to work in IE7, add the following after declaring crel.

    var testDiv = document.createElement('div'),
        testLabel = document.createElement('label');

    testDiv.setAttribute('class', 'a');
    testDiv['className'] !== 'a' ? crel.attrMap['class'] = 'className':undefined;
    testDiv.setAttribute('name','a');
    testDiv['name'] !== 'a' ? crel.attrMap['name'] = function(element, value){
        element.id = value;
    }:undefined;


    testLabel.setAttribute('for', 'a');
    testLabel['htmlFor'] !== 'a' ? crel.attrMap['for'] = 'htmlFor':undefined;



*/

(function (root, factory) {
    if (typeof exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define(factory);
    } else {
        root.crel = factory();
    }
}(this, function () {
    var fn = 'function',
        obj = 'object',
        nodeType = 'nodeType',
        textContent = 'textContent',
        setAttribute = 'setAttribute',
        attrMapString = 'attrMap',
        isNodeString = 'isNode',
        isElementString = 'isElement',
        d = typeof document === obj ? document : {},
        isType = function(a, type){
            return typeof a === type;
        },
        isNode = typeof Node === fn ? function (object) {
            return object instanceof Node;
        } :
        // in IE <= 8 Node is an object, obviously..
        function(object){
            return object &&
                isType(object, obj) &&
                (nodeType in object) &&
                isType(object.ownerDocument,obj);
        },
        isElement = function (object) {
            return crel[isNodeString](object) && object[nodeType] === 1;
        },
        isArray = function(a){
            return a instanceof Array;
        },
        appendChild = function(element, child) {
            if (isArray(child)) {
                child.map(function(subChild){
                    appendChild(element, subChild);
                });
                return;
            }
            if(!crel[isNodeString](child)){
                child = d.createTextNode(child);
            }
            element.appendChild(child);
        };


    function crel(){
        var args = arguments, //Note: assigned to a variable to assist compilers. Saves about 40 bytes in closure compiler. Has negligable effect on performance.
            element = args[0],
            child,
            settings = args[1],
            childIndex = 2,
            argumentsLength = args.length,
            attributeMap = crel[attrMapString];

        element = crel[isElementString](element) ? element : d.createElement(element);
        // shortcut
        if(argumentsLength === 1){
            return element;
        }

        if(!isType(settings,obj) || crel[isNodeString](settings) || isArray(settings)) {
            --childIndex;
            settings = null;
        }

        // shortcut if there is only one child that is a string
        if((argumentsLength - childIndex) === 1 && isType(args[childIndex], 'string') && element[textContent] !== undefined){
            element[textContent] = args[childIndex];
        }else{
            for(; childIndex < argumentsLength; ++childIndex){
                child = args[childIndex];

                if(child == null){
                    continue;
                }

                if (isArray(child)) {
                  for (var i=0; i < child.length; ++i) {
                    appendChild(element, child[i]);
                  }
                } else {
                  appendChild(element, child);
                }
            }
        }

        for(var key in settings){
            if(!attributeMap[key]){
                if(isType(settings[key],fn)){
                    element[key] = settings[key];
                }else{
                    element[setAttribute](key, settings[key]);
                }
            }else{
                var attr = attributeMap[key];
                if(typeof attr === fn){
                    attr(element, settings[key]);
                }else{
                    element[setAttribute](attr, settings[key]);
                }
            }
        }

        return element;
    }

    // Used for mapping one kind of attribute to the supported version of that in bad browsers.
    crel[attrMapString] = {};

    crel[isElementString] = isElement;

    crel[isNodeString] = isNode;

    if(typeof Proxy !== 'undefined'){
        crel.proxy = new Proxy(crel, {
            get: function(target, key){
                !(key in crel) && (crel[key] = crel.bind(null, key));
                return crel[key];
            }
        });
    }

    return crel;
}));

},{}],10:[function(require,module,exports){
function compare(a, b, visited){
    var aType = typeof a;

    if(aType !== typeof b){
        return false;
    }

    if(a == null || b == null || !(aType === 'object' || aType === 'function')){
        if(aType === 'number' && isNaN(a) && isNaN(b)){
            return true;
        }

        return a === b;
    }

    if(Array.isArray(a) !== Array.isArray(b)){
        return false;
    }

    var aKeys = Object.keys(a),
        bKeys = Object.keys(b);

    if(aKeys.length !== bKeys.length){
        return false;
    }

    var equal = true;

    if(!visited){
        visited = new Set();
    }

    aKeys.forEach(function(key){
        if(!(key in b)){
            equal = false;
            return;
        }
        if(a[key] && a[key] instanceof Object){
            if(visited.has(a[key])){
                return;
            }
            visited.add(a[key]);
        }
        if(!compare(a[key], b[key], visited)){
            equal = false;
            return;
        }
    });

    return equal;
};

module.exports = function(a, b){
    return compare(a, b);
}
},{}],11:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}],12:[function(require,module,exports){
var is = require('./is'),
    GENERIC = '_generic',
    EventEmitter = require('events').EventEmitter,
    slice = Array.prototype.slice;

function flatten(item){
    return Array.isArray(item) ? item.reduce(function(result, element){
        if(element == null){
            return result;
        }
        return result.concat(flatten(element));
    },[]) : item;
}

function attachProperties(object, firm){
    for(var key in this._properties){
        this._properties[key].attach(object, firm);
    }
}

function onRender(){

    // Ensure all bindings are somewhat attached just before rendering
    this.attach(undefined, 0);

    for(var key in this._properties){
        this._properties[key].update();
    }
}

function detachProperties(firm){
    for(var key in this._properties){
        this._properties[key].detach(firm);
    }
}

function destroyProperties(){
    for(var key in this._properties){
        this._properties[key].destroy();
    }
}

function clone(){
    return this.fastn(this.component._type, this.component._settings, this.component._children.filter(function(child){
            return !child._templated;
        }).map(function(child){
            return typeof child === 'object' ? child.clone() : child;
        })
    );
}

function getSetBinding(newBinding){
    if(!arguments.length){
        return this.binding;
    }

    if(!is.binding(newBinding)){
        newBinding = this.fastn.binding(newBinding);
    }

    if(this.binding && this.binding !== newBinding){
        this.binding.removeListener('change', this.emitAttach);
        newBinding.attach(this.binding._model, this.binding._firm);
    }

    this.binding = newBinding;

    this.binding.on('change', this.emitAttach);
    this.binding.on('detach', this.emitDetach);

    this.emitAttach();

    return this.component;
};

function emitAttach(){
    var newBound = this.binding();
    if(newBound !== this.lastBound){
        this.lastBound = newBound;
        this.scope.attach(this.lastBound);
        this.component.emit('attach', this.scope, 1);
    }
}

function emitDetach(){
    this.component.emit('detach', 1);
}

function getScope(){
    return this.scope;
}

function destroy(){
    if(this.destroyed){
        return;
    }
    this.destroyed = true;

    this.component
        .removeAllListeners('render')
        .removeAllListeners('attach');

    this.component.emit('destroy');
    this.component.element = null;
    this.scope.destroy();
    this.binding.destroy(true);

    return this.component;
}

function attachComponent(object, firm){
    this.binding.attach(object, firm);
    return this.component;
}

function detachComponent(firm){
    this.binding.detach(firm);
    return this.component;
}

function isDestroyed(){
    return this.destroyed;
}

function setProperty(key, property){

    // Add a default property or use the one already there
    if(!property){
        property = this.component[key] || this.fastn.property();
    }

    this.component[key] = property;
    this.component._properties[key] = property;

    return this.component;
}

function bindInternalProperty(component, model, propertyName, propertyTransform){
    if(!(propertyName in component)){
        component.setProperty(propertyName);
    }
    component[propertyName].on('change', function(value){
        model.set(propertyName, propertyTransform ? propertyTransform(value) : value);
    });
}

function createInternalScope(data, propertyTransforms){
    var componentScope = this;
    var model = new componentScope.fastn.Model(data);

    for(var key in data){
        bindInternalProperty(componentScope.component, model, key, propertyTransforms[key]);
    }

    return {
        binding: function(){
            return componentScope.fastn.binding.apply(null, arguments).attach(model);
        },
        model: model
    };
}

function extendComponent(type, settings, children){

    if(type in this.types){
        return this.component;
    }

    if(!(type in this.fastn.components)){

        if(!(GENERIC in this.fastn.components)){
            throw new Error('No component of type "' + type + '" is loaded');
        }

        this.fastn.components._generic(this.fastn, this.component, type, settings, children, createInternalScope.bind(this));

        this.types._generic = true;
    }else{

        this.fastn.components[type](this.fastn, this.component, type, settings, children, createInternalScope.bind(this));
    }

    this.types[type] = true;

    return this.component;
};

function isType(type){
    return type in this.types;
}

function FastnComponent(fastn, type, settings, children){
    var component = this;

    var componentScope = {
        types: {},
        fastn: fastn,
        component: component,
        binding: fastn.binding('.'),
        destroyed: false,
        scope: new fastn.Model(false),
        lastBound: null
    };

    componentScope.emitAttach = emitAttach.bind(componentScope);
    componentScope.emitDetach = emitDetach.bind(componentScope);
    componentScope.binding._default_binding = true;

    component._type = type;
    component._properties = {};
    component._settings = settings || {};
    component._children = children ? flatten(children) : [];

    component.attach = attachComponent.bind(componentScope);
    component.detach = detachComponent.bind(componentScope);
    component.scope = getScope.bind(componentScope);
    component.destroy = destroy.bind(componentScope);
    component.destroyed = isDestroyed.bind(componentScope);
    component.binding = getSetBinding.bind(componentScope);
    component.setProperty = setProperty.bind(componentScope);
    component.clone = clone.bind(componentScope);
    component.children = slice.bind(component._children);
    component.extend = extendComponent.bind(componentScope);
    component.is = isType.bind(componentScope);

    component.binding(componentScope.binding);

    component.on('attach', attachProperties.bind(this));
    component.on('render', onRender.bind(this));
    component.on('detach', detachProperties.bind(this));
    component.on('destroy', destroyProperties.bind(this));

    if(fastn.debug){
        component.on('render', function(){
            if(component.element && typeof component.element === 'object'){
                component.element._component = component;
            }
        });
    }
}
FastnComponent.prototype = Object.create(EventEmitter.prototype);
FastnComponent.prototype.constructor = FastnComponent;
FastnComponent.prototype._fastn_component = true;

module.exports = FastnComponent;
},{"./is":20,"events":11}],13:[function(require,module,exports){
var is = require('./is'),
    firmer = require('./firmer'),
    functionEmitter = require('function-emitter'),
    setPrototypeOf = require('setprototypeof'),
    same = require('same-value');

function noop(x){
    return x;
}

function fuseBinding(){
    var fastn = this,
        args = Array.prototype.slice.call(arguments);

    var bindings = args.slice(),
        transform = bindings.pop(),
        updateTransform,
        resultBinding = createBinding.call(fastn, 'result'),
        selfChanging;

    resultBinding._arguments = args;

    if(typeof bindings[bindings.length-1] === 'function' && !is.binding(bindings[bindings.length-1])){
        updateTransform = transform;
        transform = bindings.pop();
    }

    resultBinding._model.removeAllListeners();
    resultBinding._set = function(value){
        if(updateTransform){
            selfChanging = true;
            var newValue = updateTransform(value);
            if(!same(newValue, bindings[0]())){
                bindings[0](newValue);
                resultBinding._change(newValue);
            }
            selfChanging = false;
        }else{
            resultBinding._change(value);
        }
    };

    function change(){
        if(selfChanging){
            return;
        }
        resultBinding(transform.apply(null, bindings.map(function(binding){
            return binding();
        })));
    }

    resultBinding.on('detach', function(firm){
        bindings.forEach(function(binding, index){
            binding.detach(firm);
        });
    });

    resultBinding.once('destroy', function(soft){
        bindings.forEach(function(binding, index){
            binding.removeListener('change', change);
            binding.destroy(soft);
        });
    });

    bindings.forEach(function(binding, index){
        if(!is.binding(binding)){
            binding = createBinding.call(fastn, binding);
            bindings.splice(index,1,binding);
        }
        binding.on('change', change);
    });

    var lastAttached;
    resultBinding.on('attach', function(object){
        selfChanging = true;
        bindings.forEach(function(binding){
            binding.attach(object, 1);
        });
        selfChanging = false;
        if(lastAttached !== object){
            change();
        }
        lastAttached = object;
    });

    return resultBinding;
}

function createValueBinding(fastn){
    var valueBinding = createBinding.call(fastn, 'value');
    valueBinding.attach = function(){return valueBinding;};
    valueBinding.detach = function(){return valueBinding;};
    return valueBinding;
}

function bindingTemplate(newValue){
    if(!arguments.length){
        return this.value;
    }

    if(this.binding._fastn_binding === '.'){
        return;
    }

    this.binding._set(newValue);
    return this.binding;
}

function modelAttachHandler(data){
    var bindingScope = this;
    bindingScope.binding._model.attach(data);
    bindingScope.binding._change(bindingScope.binding._model.get(bindingScope.path));
    bindingScope.binding.emit('attach', data, 1);
}

function modelDetachHandler(){
    this.binding._model.detach();
}

function attach(object, firm){
    var bindingScope = this;
    var binding = bindingScope.binding;
    // If the binding is being asked to attach loosly to an object,
    // but it has already been defined as being firmly attached, do not attach.
    if(firmer(binding, firm)){
        return binding;
    }

    binding._firm = firm;

    var isModel = bindingScope.fastn.isModel(object);

    if(isModel && bindingScope.attachedModel === object){
        return binding;
    }

    if(bindingScope.attachedModel){
        bindingScope.attachedModel.removeListener('attach', bindingScope.modelAttachHandler);
        bindingScope.attachedModel.removeListener('detach', bindingScope.modelDetachHandler);
        bindingScope.attachedModel = null;
    }

    if(isModel){
        bindingScope.attachedModel = object;
        bindingScope.attachedModel.on('attach', bindingScope.modelAttachHandler);
        bindingScope.attachedModel.on('detach', bindingScope.modelDetachHandler);
        object = object._model;
    }

    if(!(object instanceof Object)){
        object = {};
    }

    if(binding._model._model === object){
        return binding;
    }

    bindingScope.modelAttachHandler(object);

    return binding;
};

function detach(firm){
    if(firmer(this.binding, firm)){
        return this.binding;
    }

    this.value = undefined;
    if(this.binding._model.isAttached()){
        this.binding._model.detach();
    }
    this.binding.emit('detach', 1);
    return this.binding;
}

function set(newValue){
    var bindingScope = this;
    if(same(bindingScope.binding._model.get(bindingScope.path), newValue)){
        return;
    }
    if(!bindingScope.binding._model.isAttached()){
        bindingScope.binding._model.attach(bindingScope.binding._model.get('.'));
    }
    bindingScope.binding._model.set(bindingScope.path, newValue);
}

function change(newValue){
    var bindingScope = this;
    bindingScope.value = newValue;
    bindingScope.binding.emit('change', bindingScope.binding());
}

function clone(keepAttachment){
    var bindingScope = this;
    var newBinding = createBinding.apply(bindingScope.fastn, bindingScope.binding._arguments);

    if(keepAttachment){
        newBinding.attach(bindingScope.attachedModel || bindingScope.binding._model._model, bindingScope.binding._firm);
    }

    return newBinding;
}

function destroy(soft){
    var bindingScope = this;
    if(bindingScope.isDestroyed){
        return;
    }
    if(soft){
        return;
    }
    bindingScope.isDestroyed = true;
    bindingScope.binding.emit('destroy', true);
    bindingScope.binding.detach();
    bindingScope.binding._model.destroy();
}

function destroyed(){
    return this.isDestroyed;
}

function createBinding(path, more){
    var fastn = this;

    if(more){ // used instead of arguments.length for performance
        return fuseBinding.apply(fastn, arguments);
    }

    if(is.binding(path)){
        return createBinding.call(this, path, noop);
    }

    if(path == null){
        return createValueBinding(fastn);
    }

    var bindingScope = {
            fastn: fastn,
            path: path
        },
        binding = bindingScope.binding = bindingTemplate.bind(bindingScope);

    setPrototypeOf(binding, functionEmitter);
    binding.setMaxListeners(10000);
    binding._arguments = [path];
    binding._model = new fastn.Model(false);
    binding._fastn_binding = path;
    binding._firm = -Infinity;

    bindingScope.modelAttachHandler = modelAttachHandler.bind(bindingScope);
    bindingScope.modelDetachHandler = modelDetachHandler.bind(bindingScope);

    binding.attach = attach.bind(bindingScope);
    binding.detach = detach.bind(bindingScope);
    binding._set = set.bind(bindingScope);
    binding._change = change.bind(bindingScope);
    binding.clone = clone.bind(bindingScope);
    binding.destroy = destroy.bind(bindingScope);
    binding.destroyed = destroyed.bind(bindingScope);

    if(path !== '.'){
        binding._model.on(path, binding._change);
    }

    return binding;
}

function from(valueOrBinding){
    if(is.binding(valueOrBinding)){
        return valueOrBinding;
    }

    var result = this();
    result(valueOrBinding)

    return result;
}

module.exports = function(fastn){
    var binding = createBinding.bind(fastn);
    binding.from = from.bind(binding);
    return binding;
};
},{"./firmer":17,"./is":20,"function-emitter":27,"same-value":40,"setprototypeof":42}],14:[function(require,module,exports){
function insertChild(fastn, container, child, index){
    if(child == null || child === false){
        return;
    }

    var currentIndex = container._children.indexOf(child),
        newComponent = fastn.toComponent(child);

    if(newComponent !== child && ~currentIndex){
        container._children.splice(currentIndex, 1, newComponent);
    }

    if(!~currentIndex || newComponent !== child){
        newComponent.attach(container.scope(), 1);
    }

    if(currentIndex !== index){
        if(~currentIndex){
            container._children.splice(currentIndex, 1);
        }
        container._children.splice(index, 0, newComponent);
    }

    if(container.element){
        if(!newComponent.element){
            newComponent.render();
        }
        container._insert(newComponent.element, index);
        newComponent.emit('insert', container);
        container.emit('childInsert', newComponent);
    }
}

function getContainerElement(){
    return this.containerElement || this.element;
}

function insert(child, index){
    var childComponent = child,
        container = this.container,
        fastn = this.fastn;

    if(index && typeof index === 'object'){
        childComponent = Array.prototype.slice.call(arguments);
    }

    if(isNaN(index)){
        index = container._children.length;
    }

    if(Array.isArray(childComponent)){
        for (var i = 0; i < childComponent.length; i++) {
            container.insert(childComponent[i], i + index);
        }
    }else{
        insertChild(fastn, container, childComponent, index);
    }

    return container;
}

module.exports = function(fastn, component, type, settings, children){
    component.insert = insert.bind({
        container: component,
        fastn: fastn
    });

    component._insert = function(element, index){
        var containerElement = component.getContainerElement();
        if(!containerElement){
            return;
        }

        if(containerElement.childNodes[index] === element){
            return;
        }

        containerElement.insertBefore(element, containerElement.childNodes[index]);
    };

    component.remove = function(childComponent){
        var index = component._children.indexOf(childComponent);
        if(~index){
            component._children.splice(index,1);
        }

        childComponent.detach(1);

        if(childComponent.element){
            component._remove(childComponent.element);
            childComponent.emit('remove', component);
        }
        component.emit('childRemove', childComponent);
    };

    component._remove = function(element){
        var containerElement = component.getContainerElement();

        if(!element || !containerElement || element.parentNode !== containerElement){
            return;
        }

        containerElement.removeChild(element);
    };

    component.empty = function(){
        while(component._children.length){
            component.remove(component._children.pop());
        }
    };

    component.replaceChild = function(oldChild, newChild){
        var index = component._children.indexOf(oldChild);

        if(!~index){
            return;
        }

        component.remove(oldChild);
        component.insert(newChild, index);
    };

    component.getContainerElement = getContainerElement.bind(component);

    component.on('render', component.insert.bind(null, component._children, 0));

    component.on('attach', function(model, firm){
        for(var i = 0; i < component._children.length; i++){
            if(fastn.isComponent(component._children[i])){
                component._children[i].attach(model, firm);
            }
        }
    });

    component.on('destroy', function(data, firm){
        for(var i = 0; i < component._children.length; i++){
            if(fastn.isComponent(component._children[i])){
                component._children[i].destroy(firm);
            }
        }
    });

    return component;
};
},{}],15:[function(require,module,exports){
module.exports = function(extra){
    var components = {
        // The _generic component is a catch-all for any component type that
        //  doesnt match any other component constructor, eg: 'div'
        _generic: require('./genericComponent'),

        // The text component is used to render text or bindings passed as children to other components.
        text: require('./textComponent'),

        // The list component is used to render items based on a set of data.
        list: require('./listComponent'),

        // The templater component is used to render one item based on some value.
        templater: require('./templaterComponent')
    };

    if(extra){
        Object.keys(extra).forEach(function(key){
            components[key] = extra[key];
        });
    }

    return components;
}
},{"./genericComponent":18,"./listComponent":21,"./templaterComponent":24,"./textComponent":25}],16:[function(require,module,exports){
var setify = require('setify'),
    classist = require('classist');

function updateTextProperty(generic, element, value){
    if(arguments.length === 2){
        return element.textContent;
    }
    element.textContent = (value == null ? '' : value);
}

module.exports = {
    class: function(generic, element, value){
        if(!generic._classist){
            generic._classist = classist(element);
        }

        if(arguments.length < 3){
            return generic._classist();
        }

        generic._classist(value);
    },
    display: function(generic, element, value){
        if(arguments.length === 2){
            return element.style.display !== 'none';
        }
        element.style.display = value ? null : 'none';
    },
    disabled: function(generic, element, value){
        if(arguments.length === 2){
            return element.hasAttribute('disabled');
        }
        if(value){
            element.setAttribute('disabled', 'disabled');
        }else{
            element.removeAttribute('disabled');
        }
    },
    textContent: updateTextProperty,
    innerText: updateTextProperty,
    innerHTML: function(generic, element, value){
        if(arguments.length === 2){
            return element.innerHTML;
        }
        element.innerHTML = (value == null ? '' : value);
    },
    value: function(generic, element, value){
        var inputType = element.type;

        if(element.nodeName === 'INPUT' && inputType === 'date'){
            if(arguments.length === 2){
                return element.value ? new Date(element.value.replace(/-/g,'/').replace('T',' ')) : null;
            }

            value = value != null ? new Date(value) : null;

            if(!value || isNaN(value)){
                element.value = null;
            }else{
                element.value = [
                    value.getFullYear(),
                    ('0' + (value.getMonth() + 1)).slice(-2),
                    ('0' + value.getDate()).slice(-2)
                ].join('-');
            }
            return;
        }

        if(arguments.length === 2){
            return element.value;
        }
        if(value === undefined){
            value = null;
        }

        if(element.nodeName === 'PROGRESS'){
            value = parseFloat(value) || 0;
        }

        setify(element, value);
    },
    max: function(generic, element, value) {
        if(arguments.length === 2){
            return element.value;
        }

        if(element.nodeName === 'PROGRESS'){
            value = parseFloat(value) || 0;
        }

        element.max = value;
    },
    style: function(generic, element, value){
        if(arguments.length === 2){
            return element.style;
        }

        if(typeof value === 'string'){
            element.style = value;
        }

        for(var key in value){
            element.style[key] = value[key];
        }
    },
    type: function(generic, element, value){
        if(arguments.length === 2){
            return element.type;
        }
        element.setAttribute('type', value);
    }
};
},{"classist":7,"setify":41}],17:[function(require,module,exports){
// Is the entity firmer than the new firmness
module.exports = function(entity, firm){
    if(firm != null && (entity._firm === undefined || firm < entity._firm)){
        return true;
    }
};
},{}],18:[function(require,module,exports){
var containerComponent = require('./containerComponent'),
    schedule = require('./schedule'),
    fancyProps = require('./fancyProps'),
    matchDomHandlerName = /^((?:el\.)?)([^. ]+)(?:\.(capture))?$/,
    GENERIC = '_generic';

function createProperties(fastn, component, settings){
    for(var key in settings){
        var setting = settings[key];

        if(typeof setting === 'function' && !fastn.isProperty(setting) && !fastn.isBinding(setting)){
            continue;
        }

        component.addDomProperty(key);
    }
}

function trackKeyEvents(component, element, event){
    if('_lastStates' in component && 'charCode' in event){
        component._lastStates.unshift(element.value);
        component._lastStates.pop();
    }
}

function addDomHandler(component, element, handlerName, eventName, capture){
    var eventParts = handlerName.split('.');

    if(eventParts[0] === 'on'){
        eventParts.shift();
    }

    var handler = function(event){
            trackKeyEvents(component, element, event);
            component.emit(handlerName, event, component.scope());
        };

    element.addEventListener(eventName, handler, capture);

    component.on('destroy', function(){
        element.removeEventListener(eventName, handler, capture);
    });
}

function addDomHandlers(component, element, eventNames){
    var events = eventNames.split(' ');

    for(var i = 0; i < events.length; i++){
        var eventName = events[i],
            match = eventName.match(matchDomHandlerName);

        if(!match){
            continue;
        }

        if(match[1] || 'on' + match[2] in element){
            addDomHandler(component, element, eventNames, match[2], match[3]);
        }
    }
}

function addAutoHandler(component, element, key, settings){
    if(!settings[key]){
        return;
    }

    var autoEvent = settings[key].split(':'),
        eventName = key.slice(2);

    delete settings[key];

    var handler = function(event){
        var fancyProp = fancyProps[autoEvent[1]],
            value = fancyProp ? fancyProp(component, element) : element[autoEvent[1]];

        trackKeyEvents(component, element, event);

        component[autoEvent[0]](value);
    };

    element.addEventListener(eventName, handler);

    component.on('destroy', function(){
        element.removeEventListener(eventName, handler);
    });
}

function addDomProperty(fastn, key, property){
    var component = this,
        timeout;

    property = property || component[key] || fastn.property();
    component.setProperty(key, property);

    function update(){

        var element = component.getPropertyElement(key),
            value = property();

        if(!element || component.destroyed()){
            return;
        }

        if(
            key === 'value' &&
            component._lastStates &&
            ~component._lastStates.indexOf(value)
        ){
            clearTimeout(timeout);
            timeout = setTimeout(update, 50);
            return;
        }

        var isProperty = key in element || !('getAttribute' in element),
            fancyProp = component._fancyProps && component._fancyProps(key) || fancyProps[key],
            previous = fancyProp ? fancyProp(component, element) : isProperty ? element[key] : element.getAttribute(key);

        if(!fancyProp && !isProperty && value == null){
            value = '';
        }

        if(value !== previous){
            if(fancyProp){
                fancyProp(component, element, value);
                return;
            }

            if(isProperty){
                element[key] = value;
                return;
            }

            if(typeof value !== 'function' && typeof value !== 'object'){
                element.setAttribute(key, value);
            }
        }
    }

    property.updater(update);
}

function onRender(){
    var component = this,
        element;

    for(var key in component._settings){
        element = component.getEventElement(key);
        if(key.slice(0,2) === 'on' && key in element){
            addAutoHandler(component, element, key, component._settings);
        }
    }

    for(var eventKey in component._events){
        element = component.getEventElement(key);
        addDomHandlers(component, element, eventKey);
    }
}

function render(){
    this.element = this.createElement(this._settings.tagName || this._tagName);

    if('value' in this.element){
        this._lastStates = new Array(2);
    }

    this.emit('render');

    return this;
};

function genericComponent(fastn, component, type, settings, children){
    if(component.is(type)){
        return component;
    }

    if(type === GENERIC){
        component._tagName = component._tagName || 'div';
    }else{
        component._tagName = type;
    }

    if(component.is(GENERIC)){
        return component;
    }

    component.extend('_container', settings, children);

    component.addDomProperty = addDomProperty.bind(component, fastn);
    component.getEventElement = component.getContainerElement;
    component.getPropertyElement = component.getContainerElement;
    component.updateProperty = genericComponent.updateProperty;
    component.createElement = genericComponent.createElement;

    createProperties(fastn, component, settings);

    component.render = render.bind(component);

    component.on('render', onRender);

    return component;
}

genericComponent.updateProperty = function(component, property, update){
    if(typeof document !== 'undefined' && document.contains(component.element)){
        schedule(property, update);
    }else{
        update();
    }
};

genericComponent.createElement = function(tagName){
    if(tagName instanceof Node){
        return tagName;
    }
    return document.createElement(tagName);
};

module.exports = genericComponent;
},{"./containerComponent":14,"./fancyProps":16,"./schedule":23}],19:[function(require,module,exports){
var createProperty = require('./property'),
    createBinding = require('./binding'),
    BaseComponent = require('./baseComponent'),
    crel = require('crel'),
    Enti = require('enti'),
    objectAssign = require('object-assign'),
    is = require('./is');

function inflateProperties(component, settings){
    for(var key in settings){
        var setting = settings[key],
            property = component[key];

        if(is.property(settings[key])){

            if(is.property(property)){
                property.destroy();
            }

            setting.addTo(component, key);

        }else if(is.property(property)){

            if(is.binding(setting)){
                property.binding(setting);
            }else{
                property(setting);
            }

            property.addTo(component, key);
        }
    }
}

function validateExpectedComponents(components, componentName, expectedComponents){
    expectedComponents = expectedComponents.filter(function(componentName){
        return !(componentName in components);
    });

    if(expectedComponents.length){
        console.warn([
            'fastn("' + componentName + '") uses some components that have not been registered with fastn',
            'Expected conponent constructors: ' + expectedComponents.join(', ')
        ].join('\n\n'));
    }
}

module.exports = function(components, debug){

    if(!components || typeof components !== 'object'){
        throw new Error('fastn must be initialised with a components object');
    }

    components._container = components._container || require('./containerComponent');

    function fastn(type){

        var args = [];
        for(var i = 0; i < arguments.length; i++){
            args[i] = arguments[i];
        }

        var settings = args[1],
            childrenIndex = 2,
            settingsChild = fastn.toComponent(args[1]);

        if(Array.isArray(args[1]) || settingsChild || !args[1]){
            if(args.length > 1){
                args[1] = settingsChild || args[1];
            }
            childrenIndex--;
            settings = null;
        }

        settings = objectAssign({}, settings || {});

        var types = typeof type === 'string' ? type.split(':') : Array.isArray(type) ? type : [type],
            baseType,
            children = args.slice(childrenIndex),
            component = fastn.base(type, settings, children);

        while(baseType = types.shift()){
            component.extend(baseType, settings, children);
        }

        component._properties = {};

        inflateProperties(component, settings);

        return component;
    }

    fastn.toComponent = function(component){
        if(component == null){
            return;
        }
        if(is.component(component)){
            return component;
        }
        if(typeof component !== 'object' || component instanceof Date){
            return fastn('text', { text: component }, component);
        }
        if(crel.isElement(component)){
            return fastn(component);
        }
        if(crel.isNode(component)){
            return fastn('text', { text: component }, component.textContent);
        }
    };

    fastn.debug = debug;
    fastn.property = createProperty.bind(fastn);
    fastn.binding = createBinding(fastn);
    fastn.isComponent = is.component;
    fastn.isBinding = is.binding;
    fastn.isDefaultBinding = is.defaultBinding;
    fastn.isBindingObject = is.bindingObject;
    fastn.isProperty = is.property;
    fastn.components = components;
    fastn.Model = Enti;
    fastn.isModel = Enti.isEnti.bind(Enti);

    fastn.base = function(type, settings, children){
        return new BaseComponent(fastn, type, settings, children);
    };

    for(var key in components){
        var componentConstructor = components[key];

        if(componentConstructor.expectedComponents){
            validateExpectedComponents(components, key, componentConstructor.expectedComponents);
        }
    }

    return fastn;
};

},{"./baseComponent":12,"./binding":13,"./containerComponent":14,"./is":20,"./property":22,"crel":9,"enti":1,"object-assign":32}],20:[function(require,module,exports){
var FUNCTION = 'function',
    OBJECT = 'object',
    FASTNBINDING = '_fastn_binding',
    FASTNPROPERTY = '_fastn_property',
    FASTNCOMPONENT = '_fastn_component',
    DEFAULTBINDING = '_default_binding';

function isComponent(thing){
    return thing && typeof thing === OBJECT && FASTNCOMPONENT in thing;
}

function isBindingObject(thing){
    return thing && typeof thing === OBJECT && FASTNBINDING in thing;
}

function isBinding(thing){
    return typeof thing === FUNCTION && FASTNBINDING in thing;
}

function isProperty(thing){
    return typeof thing === FUNCTION && FASTNPROPERTY in thing;
}

function isDefaultBinding(thing){
    return typeof thing === FUNCTION && FASTNBINDING in thing && DEFAULTBINDING in thing;
}

module.exports = {
    component: isComponent,
    bindingObject: isBindingObject,
    binding: isBinding,
    defaultBinding: isDefaultBinding,
    property: isProperty
};
},{}],21:[function(require,module,exports){
(function (global){
var MultiMap = require('multimap'),
    merge = require('flat-merge');

var requestIdleCallback = global.requestIdleCallback || global.requestAnimationFrame || global.setTimeout;

MultiMap.Map = Map;

function each(value, fn){
    if(!value || typeof value !== 'object'){
        return;
    }

    if(Array.isArray(value)){
        for(var i = 0; i < value.length; i++){
            fn(value[i], i)
        }
    }else{
        for(var key in value){
            fn(value[key], key);
        }
    }
}

function keyFor(object, value){
    if(!object || typeof object !== 'object'){
        return false;
    }

    if(Array.isArray(object)){
        var index = object.indexOf(value);
        return index >=0 ? index : false;
    }

    for(var key in object){
        if(object[key] === value){
            return key;
        }
    }

    return false;
}

module.exports = function(fastn, component, type, settings, children){

    if(fastn.components._generic){
        component.extend('_generic', settings, children);
    }else{
        component.extend('_container', settings, children);
    }

    if(!('template' in settings)){
        console.warn('No "template" function was set for this templater component');
    }

    var itemsMap = new MultiMap(),
        dataMap = new WeakMap(),
        lastTemplate,
        existingItem = {};

    var insertQueue = [];
    var inserting;

    function updateOrCreateChild(template, item, key){
        var child,
            existing;

        if(Array.isArray(item) && item[0] === existingItem){
            existing = true;
            child = item[2];
            item = item[1];
        }

        var childModel;

        if(!existing){
            childModel = new fastn.Model({
                item: item,
                key: key
            });

            child = fastn.toComponent(template(childModel, component.scope()));
            if(!child){
                child = fastn('template');
            }
            child._listItem = item;
            child._templated = true;

            dataMap.set(child, childModel);
            itemsMap.set(item, child);
        }else{
            childModel = dataMap.get(child);
            childModel.set('key', key);
        }

        if(fastn.isComponent(child) && component._settings.attachTemplates !== false){
            child.attach(childModel, 2);
        }

        return child;
    }

    function insertNextItems(template, insertionFrameTime){
        if(inserting){
            return;
        }

        inserting = true;
        component.emit('insertionStart', insertQueue.length);

        insertQueue.sort(function(a, b){
            return a[2] - b[2];
        });

        function insertNext(){
            var startTime = Date.now();

            while(insertQueue.length && Date.now() - startTime < insertionFrameTime) {
                var nextInsersion = insertQueue.shift();
                var child = updateOrCreateChild(template, nextInsersion[0], nextInsersion[1]);
                component.insert(child, nextInsersion[2]);
            }

            if(!insertQueue.length || component.destroyed()){
                inserting = false;
                if(!component.destroyed()){
                    component.emit('insertionComplete');
                }
                return;
            }

            requestIdleCallback(insertNext);
        }

        insertNext();
    }

    function updateItems(){
        insertQueue = [];

        var value = component.items(),
            template = component.template(),
            emptyTemplate = component.emptyTemplate(),
            insertionFrameTime = component.insertionFrameTime() || Infinity,
            newTemplate = lastTemplate !== template;

        var currentItems = merge(template ? value : []);

        itemsMap.forEach(function(childComponent, item){
            var currentKey = keyFor(currentItems, item);

            if(!newTemplate && currentKey !== false){
                currentItems[currentKey] = [existingItem, item, childComponent];
            }else{
                removeComponent(childComponent);
                itemsMap.delete(item);
            }
        });

        var index = 0;
        var templateIndex = 0;

        function updateItem(item, key){
            while(index < component._children.length && !component._children[index]._templated){
                index++;
            }

            insertQueue.push([item, key, index + templateIndex]);
            templateIndex++;
        }

        each(currentItems, updateItem);

        template && insertNextItems(template, insertionFrameTime);

        lastTemplate = template;

        if(templateIndex === 0 && emptyTemplate){
            var child = fastn.toComponent(emptyTemplate(component.scope()));
            if(!child){
                child = fastn('template');
            }
            child._templated = true;

            itemsMap.set({}, child);

            component.insert(child);
        }
    }

    function removeComponent(childComponent){
        component.remove(childComponent);
        childComponent.destroy();
    }

    component.setProperty('insertionFrameTime');

    component.setProperty('items',
        fastn.property([], settings.itemChanges || 'type keys shallowStructure')
            .on('change', updateItems)
    );

    component.setProperty('template',
        fastn.property().on('change', updateItems)
    );

    component.setProperty('emptyTemplate',
        fastn.property().on('change', updateItems)
    );

    return component;
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"flat-merge":26,"multimap":30}],22:[function(require,module,exports){
var WhatChanged = require('what-changed'),
    same = require('same-value'),
    firmer = require('./firmer'),
    functionEmitter = require('function-emitter'),
    setPrototypeOf = require('setprototypeof');

var propertyProto = Object.create(functionEmitter);

propertyProto._fastn_property = true;
propertyProto._firm = 1;

function propertyTemplate(value){
    if(!arguments.length){
        return this.binding && this.binding() || this.property._value;
    }

    if(!this.destroyed){
        if(this.binding){
            this.binding(value);
            return this.property;
        }

        this.valueUpdate(value);
    }

    return this.property;
}

function changeChecker(current, changes){
    if(changes){
        var changes = new WhatChanged(current, changes);

        return function(value){
            return changes.update(value).any;
        };
    }else{
        var lastValue = current;
        return function(newValue){
            if(!same(lastValue, newValue)){
                lastValue = newValue;
                return true;
            }
        };
    }
}


function propertyBinding(newBinding){
    if(!arguments.length){
        return this.binding;
    }

    if(!this.fastn.isBinding(newBinding)){
        newBinding = this.fastn.binding(newBinding);
    }

    if(newBinding === this.binding){
        return this.property;
    }

    if(this.binding){
        this.binding.removeListener('change', this.valueUpdate);
    }

    this.binding = newBinding;

    if(this.model){
        this.property.attach(this.model, this.property._firm);
    }

    this.binding.on('change', this.valueUpdate);
    this.valueUpdate(this.binding());

    return this.property;
};

function attachProperty(object, firm){
    if(firmer(this.property, firm)){
        return this.property;
    }

    this.property._firm = firm;

    if(!(object instanceof Object)){
        object = {};
    }

    if(this.binding){
        this.model = object;
        this.binding.attach(object, 1);
    }

    if(this.property._events && 'attach' in this.property._events){
        this.property.emit('attach', object, 1);
    }

    return this.property;
};

function detachProperty(firm){
    if(firmer(this.property, firm)){
        return this.property;
    }

    if(this.binding){
        this.binding.removeListener('change', this.valueUpdate);
        this.binding.detach(1);
        this.model = null;
    }

    if(this.property._events && 'detach' in this.property._events){
        this.property.emit('detach', 1);
    }

    return this.property;
};

function updateProperty(){
    if(!this.destroyed){

        if(this.property._update){
            this.property._update(this.property._value, this.property);
        }

        this.property.emit('update', this.property._value);
    }
    return this.property;
};

function propertyUpdater(fn){
    if(!arguments.length){
        return this.property._update;
    }
    this.property._update = fn;
    return this.property;
};

function destroyProperty(){
    if(!this.destroyed){
        this.destroyed = true;

        this.property
            .removeAllListeners('change')
            .removeAllListeners('update')
            .removeAllListeners('attach');

        this.property.emit('destroy');
        this.property.detach();
        if(this.binding){
            this.binding.destroy(true);
        }
    }
    return this.property;
};

function propertyDestroyed(){
    return this.destroyed;
};

function addPropertyTo(component, key){
    component.setProperty(key, this.property);

    return this.property;
};

function createProperty(currentValue, changes, updater){
    if(typeof changes === 'function'){
        updater = changes;
        changes = null;
    }

    var propertyScope = {
            fastn: this,
            hasChanged: changeChecker(currentValue, changes)
        },
        property = propertyTemplate.bind(propertyScope);

    propertyScope.valueUpdate = function(value){
        property._value = value;
        if(!propertyScope.hasChanged(value)){
            return;
        }
        property.emit('change', property._value);
        property.update();
    };

    var property = propertyScope.property = propertyTemplate.bind(propertyScope);

    property._value = currentValue;
    property._update = updater;

    setPrototypeOf(property, propertyProto);

    property.binding = propertyBinding.bind(propertyScope);
    property.attach = attachProperty.bind(propertyScope);
    property.detach = detachProperty.bind(propertyScope);
    property.update = updateProperty.bind(propertyScope);
    property.updater = propertyUpdater.bind(propertyScope);
    property.destroy = destroyProperty.bind(propertyScope);
    property.destroyed = propertyDestroyed.bind(propertyScope);
    property.addTo = addPropertyTo.bind(propertyScope);

    return property;
};

module.exports = createProperty;
},{"./firmer":17,"function-emitter":27,"same-value":40,"setprototypeof":42,"what-changed":44}],23:[function(require,module,exports){
var todo = [],
    todoKeys = [],
    scheduled,
    updates = 0;

function run(){
    var startTime = Date.now();

    while(todo.length && Date.now() - startTime < 16){
        todoKeys.shift();
        todo.shift()();
    }

    if(todo.length){
        requestAnimationFrame(run);
    }else{
        scheduled = false;
    }
}

function schedule(key, fn){
    if(~todoKeys.indexOf(key)){
        return;
    }

    todo.push(fn);
    todoKeys.push(key);

    if(!scheduled){
        scheduled = true;
        requestAnimationFrame(run);
    }
}

module.exports = schedule;
},{}],24:[function(require,module,exports){
module.exports = function(fastn, component, type, settings, children){
    var itemModel = new fastn.Model({});

    if(!('template' in settings)){
        console.warn('No "template" function was set for this templater component');
    }

    function replaceElement(element){
        if(component.element && component.element.parentNode){
            component.element.parentNode.replaceChild(element, component.element);
        }
        component.element = element;
    }

    function update(){

        var value = component.data(),
            template = component.template();

        itemModel.set('item', value);

        var newComponent;

        if(template){
           newComponent = fastn.toComponent(template(itemModel, component.scope(), component._currentComponent));
        }

        if(component._currentComponent && component._currentComponent !== newComponent){
            if(fastn.isComponent(component._currentComponent)){
                component._currentComponent.destroy();
            }
        }

        component._currentComponent = newComponent;

        if(!newComponent){
            replaceElement(component.emptyElement);
            return;
        }

        if(fastn.isComponent(newComponent)){
            if(component._settings.attachTemplates !== false){
                newComponent.attach(itemModel, 2);
            }else{
                newComponent.attach(component.scope(), 1);
            }

            if(component.element && component.element !== newComponent.element){
                if(newComponent.element == null){
                    newComponent.render();
                }
                replaceElement(component._currentComponent.element);
            }
        }
    }

    component.render = function(){
        var element;
        component.emptyElement = document.createTextNode('');
        if(component._currentComponent){
            component._currentComponent.render();
            element = component._currentComponent.element;
        }
        component.element = element || component.emptyElement;
        component.emit('render');
        return component;
    };

    component.setProperty('data',
        fastn.property(undefined, settings.dataChanges || 'value structure')
            .on('change', update)
    );

    component.setProperty('template',
        fastn.property(undefined, 'value reference')
            .on('change', update)
    );

    component.on('destroy', function(){
        if(fastn.isComponent(component._currentComponent)){
            component._currentComponent.destroy();
        }
    });

    component.on('attach', function(data){
        if(fastn.isComponent(component._currentComponent)){
            component._currentComponent.attach(component.scope(), 1);
        }
    });

    return component;
};
},{}],25:[function(require,module,exports){
function updateText(){
    if(!this.element){
        return;
    }

    var value = this.text();

    this.element.textContent = (value == null ? '' : value);
}

function autoRender(content){
    this.element = document.createTextNode(content);
}

function autoText(text, fastn, content) {
    text.render = autoRender.bind(text, content);

    return text;
}

function render(){
    this.element = this.createTextNode(this.text());
    this.emit('render');
};

function textComponent(fastn, component, type, settings, children){
    component.createTextNode = textComponent.createTextNode;
    component.render = render.bind(component);

    component.setProperty('text', fastn.property('', updateText.bind(component)));

    return component;
}

textComponent.createTextNode = function(text){
    return document.createTextNode(text);
};

module.exports = textComponent;
},{}],26:[function(require,module,exports){
function flatMerge(a,b){
    if(!b || typeof b !== 'object'){
        b = {};
    }

    if(!a || typeof a !== 'object'){
        a = new b.constructor();
    }

    var result = new a.constructor(),
        aKeys = Object.keys(a),
        bKeys = Object.keys(b);

    for(var i = 0; i < aKeys.length; i++){
        result[aKeys[i]] = a[aKeys[i]];
    }

    for(var i = 0; i < bKeys.length; i++){
        result[bKeys[i]] = b[bKeys[i]];
    }

    return result;
}

module.exports = flatMerge;
},{}],27:[function(require,module,exports){
var EventEmitter = require('events').EventEmitter,
    functionEmitterPrototype = function(){};

for(var key in EventEmitter.prototype){
    functionEmitterPrototype[key] = EventEmitter.prototype[key];
}

module.exports = functionEmitterPrototype;
},{"events":11}],28:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],29:[function(require,module,exports){
arguments[4][2][0].apply(exports,arguments)
},{"dup":2}],30:[function(require,module,exports){
"use strict";

/* global module, define */

function mapEach(map, operation){
  var keys = map.keys();
  var next;
  while(!(next = keys.next()).done) {
    operation(map.get(next.value), next.value, map);
  }
}

var Multimap = (function() {
  var mapCtor;
  if (typeof Map !== 'undefined') {
    mapCtor = Map;

    if (!Map.prototype.keys) {
      Map.prototype.keys = function() {
        var keys = [];
        this.forEach(function(item, key) {
          keys.push(key);
        });
        return keys;
      };
    }
  }

  function Multimap(iterable) {
    var self = this;

    self._map = mapCtor;

    if (Multimap.Map) {
      self._map = Multimap.Map;
    }

    self._ = self._map ? new self._map() : {};

    if (iterable) {
      iterable.forEach(function(i) {
        self.set(i[0], i[1]);
      });
    }
  }

  /**
   * @param {Object} key
   * @return {Array} An array of values, undefined if no such a key;
   */
  Multimap.prototype.get = function(key) {
    return this._map ? this._.get(key) : this._[key];
  };

  /**
   * @param {Object} key
   * @param {Object} val...
   */
  Multimap.prototype.set = function(key, val) {
    var args = Array.prototype.slice.call(arguments);

    key = args.shift();

    var entry = this.get(key);
    if (!entry) {
      entry = [];
      if (this._map)
        this._.set(key, entry);
      else
        this._[key] = entry;
    }

    Array.prototype.push.apply(entry, args);
    return this;
  };

  /**
   * @param {Object} key
   * @param {Object=} val
   * @return {boolean} true if any thing changed
   */
  Multimap.prototype.delete = function(key, val) {
    if (!this.has(key))
      return false;

    if (arguments.length == 1) {
      this._map ? (this._.delete(key)) : (delete this._[key]);
      return true;
    } else {
      var entry = this.get(key);
      var idx = entry.indexOf(val);
      if (idx != -1) {
        entry.splice(idx, 1);
        return true;
      }
    }

    return false;
  };

  /**
   * @param {Object} key
   * @param {Object=} val
   * @return {boolean} whether the map contains 'key' or 'key=>val' pair
   */
  Multimap.prototype.has = function(key, val) {
    var hasKey = this._map ? this._.has(key) : this._.hasOwnProperty(key);

    if (arguments.length == 1 || !hasKey)
      return hasKey;

    var entry = this.get(key) || [];
    return entry.indexOf(val) != -1;
  };


  /**
   * @return {Array} all the keys in the map
   */
  Multimap.prototype.keys = function() {
    if (this._map)
      return makeIterator(this._.keys());

    return makeIterator(Object.keys(this._));
  };

  /**
   * @return {Array} all the values in the map
   */
  Multimap.prototype.values = function() {
    var vals = [];
    this.forEachEntry(function(entry) {
      Array.prototype.push.apply(vals, entry);
    });

    return makeIterator(vals);
  };

  /**
   *
   */
  Multimap.prototype.forEachEntry = function(iter) {
    mapEach(this, iter);
  };

  Multimap.prototype.forEach = function(iter) {
    var self = this;
    self.forEachEntry(function(entry, key) {
      entry.forEach(function(item) {
        iter(item, key, self);
      });
    });
  };


  Multimap.prototype.clear = function() {
    if (this._map) {
      this._.clear();
    } else {
      this._ = {};
    }
  };

  Object.defineProperty(
    Multimap.prototype,
    "size", {
      configurable: false,
      enumerable: true,
      get: function() {
        var total = 0;

        mapEach(this, function(value){
          total += value.length;
        });

        return total;
      }
    });

  var safariNext;

  try{
    safariNext = new Function('iterator', 'makeIterator', 'var keysArray = []; for(var key of iterator){keysArray.push(key);} return makeIterator(keysArray).next;');
  }catch(error){
    // for of not implemented;
  }

  function makeIterator(iterator){
    if(Array.isArray(iterator)){
      var nextIndex = 0;

      return {
        next: function(){
          return nextIndex < iterator.length ?
            {value: iterator[nextIndex++], done: false} :
          {done: true};
        }
      };
    }

    // Only an issue in safari
    if(!iterator.next && safariNext){
      iterator.next = safariNext(iterator, makeIterator);
    }

    return iterator;
  }

  return Multimap;
})();


if(typeof exports === 'object' && module && module.exports)
  module.exports = Multimap;
else if(typeof define === 'function' && define.amd)
  define(function() { return Multimap; });

},{}],31:[function(require,module,exports){
var supportedTypes = ['textarea', 'text', 'search', 'tel', 'url', 'password'];

module.exports = function(element) {
    return !!(element.setSelectionRange && ~supportedTypes.indexOf(element.type));
};

},{}],32:[function(require,module,exports){
/*
object-assign
(c) Sindre Sorhus
@license MIT
*/

'use strict';
/* eslint-disable no-unused-vars */
var getOwnPropertySymbols = Object.getOwnPropertySymbols;
var hasOwnProperty = Object.prototype.hasOwnProperty;
var propIsEnumerable = Object.prototype.propertyIsEnumerable;

function toObject(val) {
	if (val === null || val === undefined) {
		throw new TypeError('Object.assign cannot be called with null or undefined');
	}

	return Object(val);
}

function shouldUseNative() {
	try {
		if (!Object.assign) {
			return false;
		}

		// Detect buggy property enumeration order in older V8 versions.

		// https://bugs.chromium.org/p/v8/issues/detail?id=4118
		var test1 = new String('abc');  // eslint-disable-line no-new-wrappers
		test1[5] = 'de';
		if (Object.getOwnPropertyNames(test1)[0] === '5') {
			return false;
		}

		// https://bugs.chromium.org/p/v8/issues/detail?id=3056
		var test2 = {};
		for (var i = 0; i < 10; i++) {
			test2['_' + String.fromCharCode(i)] = i;
		}
		var order2 = Object.getOwnPropertyNames(test2).map(function (n) {
			return test2[n];
		});
		if (order2.join('') !== '0123456789') {
			return false;
		}

		// https://bugs.chromium.org/p/v8/issues/detail?id=3056
		var test3 = {};
		'abcdefghijklmnopqrst'.split('').forEach(function (letter) {
			test3[letter] = letter;
		});
		if (Object.keys(Object.assign({}, test3)).join('') !==
				'abcdefghijklmnopqrst') {
			return false;
		}

		return true;
	} catch (err) {
		// We don't expect any of the above to throw, but better to be safe.
		return false;
	}
}

module.exports = shouldUseNative() ? Object.assign : function (target, source) {
	var from;
	var to = toObject(target);
	var symbols;

	for (var s = 1; s < arguments.length; s++) {
		from = Object(arguments[s]);

		for (var key in from) {
			if (hasOwnProperty.call(from, key)) {
				to[key] = from[key];
			}
		}

		if (getOwnPropertySymbols) {
			symbols = getOwnPropertySymbols(from);
			for (var i = 0; i < symbols.length; i++) {
				if (propIsEnumerable.call(from, symbols[i])) {
					to[symbols[i]] = from[symbols[i]];
				}
			}
		}
	}

	return to;
};

},{}],33:[function(require,module,exports){
var Scope = require('./scope'),
    toValue = require('./toValue'),
    isInstance = require('is-instance');

var reservedKeywords = {
    'true': true,
    'false': false,
    'null': null,
    'undefined': undefined
};

function resolveSpreads(content, scope){
    var result = [];

    content.forEach(function(token){

        if(token.name === 'spread'){
            result.push.apply(result, executeToken(token, scope).value);
            return;
        }

        result.push(executeToken(token, scope).value);
    });

    return result;
}

function functionCall(token, scope){
    var functionToken = executeToken(token.target, scope),
        fn = functionToken.value;

    if(typeof fn !== 'function'){
        scope.throw(fn + ' is not a function');
    }

    if(scope.hasError()){
        return;
    }

    if(fn.__preshFunction__){
        return fn.apply(functionToken.context, resolveSpreads(token.content, scope));
    }

    try{
        return fn.apply(functionToken.context, resolveSpreads(token.content, scope));
    }catch(error){
        scope.throw(error);
    }
}

function functionExpression(token, scope){
    var fn = function(){
        var args = arguments,
            functionScope = new Scope(scope);

        token.parameters.forEach(function(parameter, index){

            if(parameter.name === 'spread'){
                functionScope.set(parameter.right.name, Array.prototype.slice.call(args, index));
                return;
            }

            functionScope.set(parameter.name, args[index]);
        });

        return execute(token.content, functionScope).value;
    };

    if(token.identifier){
        scope.set(token.identifier.name, fn);
    }

    fn.__preshFunction__ = true;

    return fn;
}

function ternary(token, scope){

    if(scope._debug){
        console.log('Executing operator: ' + operator.name, operator.left, operator.right);
    }

    return executeToken(token.left, scope).value ?
        executeToken(token.middle, scope).value :
        executeToken(token.right, scope).value;
}

function identifier(token, scope){
    var name = token.name;
    if(name in reservedKeywords){
        return reservedKeywords[name];
    }
    if(!scope.isDefined(name)){
        scope.throw(name + ' is not defined');
    }
    return scope.get(name);
}

function number(token){
    return token.value;
}

function string(token){
    return token.value;
}

function getProperty(token, scope, target, accessor){

    if(!target || !(typeof target === 'object' || typeof target === 'function')){
        scope.throw('target is not an object');
        return;
    }


    var result = target.hasOwnProperty(accessor) ? target[accessor] : undefined;

    if(typeof result === 'function'){
        result = toValue(result, scope, target);
    }

    return result;
}

function period(token, scope){
    var target = executeToken(token.left, scope).value;

    return getProperty(token, scope, target, token.right.name);
}

function accessor(token, scope){
    var accessorValue = execute(token.content, scope).value,
        target = executeToken(token.target, scope).value;

    return getProperty(token, scope, target, accessorValue);
}

function spread(token, scope){
    var target = executeToken(token.right, scope).value;

    if(!Array.isArray(target)){
        scope.throw('target did not resolve to an array');
    }

    return target;
}

function set(token, scope){
    if(token.content.length === 1 && token.content[0].name === 'range'){
        var range = token.content[0],
            start = executeToken(range.left, scope).value,
            end = executeToken(range.right, scope).value,
            reverse = end < start,
            result = [];

        for (var i = start; reverse ? i >= end : i <= end; reverse ? i-- : i++) {
            result.push(i);
        }

        return result;
    }

    return resolveSpreads(token.content, scope);
}

function value(token){
    return token.value;
}

function object(token, scope){
    var result = {};

    var content = token.content;

    for(var i = 0; i < content.length; i ++) {
        var child = content[i],
            key,
            value;

        if(child.name === 'tuple'){
            if(child.left.type === 'identifier'){
                key = child.left.name;
            }else if(child.left.type === 'set' && child.left.content.length === 1){
                key = executeToken(child.left.content[0], scope).value;
            }else{
                scope.throw('Unexpected token in object constructor: ' + child.type);
                return;
            }

            value = executeToken(child.right, scope).value;
        }else if(child.type === 'identifier'){
            key = child.name;
            value = executeToken(child, scope).value;
        }else if(child.name === 'spread'){
            var source = executeToken(child.right, scope).value;

            if(!isInstance(source)){
                scope.throw('Target did not resolve to an instance of an object');
                return;
            }

            Object.assign(result, source);
            continue;
        }else if(child.name === 'delete'){
            var targetIdentifier = child.right;

            if(targetIdentifier.type !== 'identifier'){
                scope.throw('Target of delete was not an identifier');
                return;
            }

            delete result[targetIdentifier.name];

            continue;
        }else{
            scope.throw('Unexpected token in object constructor: ' + child.type);
            return;
        }

        result[key] = value;
    }

    return result;
}

var handlers = {
    ternary: ternary,
    functionCall: functionCall,
    functionExpression: functionExpression,
    number: number,
    string: string,
    identifier: identifier,
    set: set,
    period: period,
    spread: spread,
    accessor: accessor,
    value: value,
    operator: operator,
    parenthesisGroup: contentHolder,
    statement: contentHolder,
    braceGroup: object
};

function nextOperatorToken(token, scope){
    return function(){
        return executeToken(token, scope).value;
    };
}

function operator(token, scope){
    if(token.name in handlers){
        return toValue(handlers[token.name](token, scope), scope);
    }

    if(token.left){
        if(scope._debug){
            console.log('Executing token: ' + token.name, token.left, token.right);
        }
        return token.operator.fn(nextOperatorToken(token.left, scope), nextOperatorToken(token.right, scope));
    }

    if(scope._debug){
        console.log('Executing operator: ' + token.name. token.right);
    }

    return token.operator.fn(nextOperatorToken(token.right, scope));
}

function contentHolder(parenthesisGroup, scope){
    return execute(parenthesisGroup.content, scope).value;
}

function executeToken(token, scope){
    if(scope._error){
        return {error: scope._error};
    }
    return toValue(handlers[token.type](token, scope), scope);
}

function execute(tokens, scope, debug){
    scope = scope instanceof Scope ? scope : new Scope(scope, debug);

    var result;
    for (var i = 0; i < tokens.length; i++) {

        result = executeToken(tokens[i], scope);

        if(result.error){
            return result;
        }
    }

    if(!result){
        return {
            error: new Error('Unknown execution error')
        };
    }

    return result;
}

module.exports = execute;
},{"./scope":38,"./toValue":39,"is-instance":29}],34:[function(require,module,exports){
module.exports = {
    log: function(x){
        console.log.apply(console, arguments);
        return x;
    },
    slice: function(items, start, end){
        return items.slice(start, end);
    },
    find: function(items, fn){
        return items.find(fn);
    },
    indexOf: function(items, value){
        return items.indexOf(value);
    },
    map: function(items, fn){
        return items.map(fn);
    },
    fold: function(items, seed, fn){
        if(arguments.length === 2){
            return items.reduce(seed);
        }
        return items.reduce(fn, seed);
    },
    String: String,
    Number: Number,
    math: Math
};
},{}],35:[function(require,module,exports){
var operators = require('./operators');

function lexString(source){
    var stringMatch = source.match(/^((["'])(?:[^\\]|\\.)*?\2)/);

    if(stringMatch){
        return {
            type: 'string',
            stringChar: stringMatch[1].charAt(0),
            source: stringMatch[1].replace(/\\(.)/g, "$1"),
            length: stringMatch[1].length
        };
    }
}

function lexWord(source){
    var match = source.match(/^(?!\-)[\w-$]+/);

    if(!match){
        return;
    }

    if(match in operators){
        return;
    }

    return {
        type: 'word',
        source: match[0],
        length: match[0].length
    };
}

function lexNumber(source){
    var specials = {
        'NaN': Number.NaN,
        'Infinity': Infinity
    };

    var token = {
        type: 'number'
    };

    for (var key in specials) {
        if (source.slice(0, key.length) === key) {
            token.source = key;
            token.length = token.source.length;

            return token;
        }
    }

    var matchExponent = source.match(/^[0-9]+(?:\.[0-9]+)?[eE]-?[0-9]+/);

    if(matchExponent){
        token.source = matchExponent[0];
        token.length = token.source.length;

        return token;
    }

    var matchHex = source.match(/^0[xX][0-9]+/);

    if(matchHex){
        token.source = matchHex[0];
        token.length = token.source.length;

        return token;
    }

    var matchHeadlessDecimal = source.match(/^\.[0-9]+/);

    if(matchHeadlessDecimal){
        token.source = matchHeadlessDecimal[0];
        token.length = token.source.length;

        return token;
    }

    var matchNormalDecimal = source.match(/^[0-9]+(?:\.[0-9]+)?/);

    if(matchNormalDecimal){
        token.source = matchNormalDecimal[0];
        token.length = token.source.length;

        return token;
    }
}

function lexComment(source){
    var match = source.match(/^(\/\*[^]*?\/)/);

    if(!match){
        return;
    }

    return {
        type: 'comment',
        source: match[0],
        length: match[0].length
    };
}

var characters = {
    '.': 'period',
    ';': 'semicolon',
    '{': 'braceOpen',
    '}': 'braceClose',
    '(': 'parenthesisOpen',
    ')': 'parenthesisClose',
    '[': 'squareBraceOpen',
    ']': 'squareBraceClose'
};

function lexCharacters(source){
    var name,
        key;

    for(key in characters){
        if(source.indexOf(key) === 0){
            name = characters[key];
            break;
        }
    }

    if(!name){
        return;
    }

    return {
        type: name,
        source: key,
        length: 1
    };
}

function lexOperators(source){
    var operator,
        key;

    for(key in operators){
        if(source.indexOf(key) === 0){
            operator = operators[key];
            break;
        }
    }

    if(!operator){
        return;
    }

    return {
        type: 'operator',
        source: key,
        length: key.length
    };
}

function lexSpread(source){
    var match = source.match(/^\.\.\./);

    if(!match){
        return;
    }

    return {
        type: 'spread',
        source: match[0],
        length: match[0].length
    };
}

function lexDelimiter(source){
    var match = source.match(/^[\s\n]+/);

    if(!match){
        return;
    }

    return {
        type: 'delimiter',
        source: match[0],
        length: match[0].length
    };
}

var lexers = [
    lexDelimiter,
    lexComment,
    lexNumber,
    lexWord,
    lexOperators,
    lexCharacters,
    lexString,
    lexSpread
];

function scanForToken(tokenisers, expression){
    for (var i = 0; i < tokenisers.length; i++) {
        var token = tokenisers[i](expression);
        if (token) {
            return token;
        }
    }
}

function lex(source, memoisedTokens) {
    var sourceRef = {
        source: source,
        toJSON: function(){}
    };

    if(!source){
        return [];
    }

    if(memoisedTokens && memoisedTokens[source]){
        return memoisedTokens[source].slice();
    }

    var originalSource = source,
        tokens = [],
        totalCharsProcessed = 0,
        previousLength;

    do {
        previousLength = source.length;

        var token;

        token = scanForToken(lexers, source);

        if(token){
            token.sourceRef = sourceRef;
            token.index = totalCharsProcessed;
            source = source.slice(token.length);
            totalCharsProcessed += token.length;
            tokens.push(token);
            continue;
        }


        if(source.length === previousLength){
            throw 'Syntax error: Unable to determine next token in source: ' + source.slice(0, 100);
        }

    } while (source);

    if(memoisedTokens){
        memoisedTokens[originalSource] = tokens.slice();
    }

    return tokens;
}

module.exports = lex;
},{"./operators":36}],36:[function(require,module,exports){
module.exports = {
    'delete': {
        unary: {
            name: 'delete',
            direction: 'right',
            precedence: 20
        }
    },
    '...': {
        unary: {
            name: 'spread',
            direction: 'right',
            precedence: 19
        }
    },
    '..': {
        binary: {
            name: 'range',
            precedence: 3
        }
    },
    '+': {
        binary: {
            name: 'add',
            fn: function(a, b) {
                return a() + b();
            },
            precedence: 13
        },
        unary:{
            name: 'positive',
            direction: 'right',
            fn: function(a) {
                return +a();
            },
            precedence: 15
        }
    },
    '-': {
        binary: {
            name: 'subtract',
            fn: function(a, b) {
                return a() - b();
            },
            precedence: 13
        },
        unary:{
            name: 'negative',
            direction: 'right',
            fn: function(a) {
                return -a();
            },
            precedence: 15
        }
    },
    '*': {
        binary: {
            name: 'multiply',
            fn: function(a, b) {
                return a() * b();
            },
            precedence: 14
        }
    },
    '/': {
        binary: {
            name: 'divide',
            fn: function(a, b) {
                return a() / b();
            },
            precedence: 14
        }
    },
    '%': {
        binary: {
            name: 'remainder',
            fn: function(a, b) {
                return a() % b();
            },
            precedence: 14
        }
    },
    'in': {
        binary: {
            name: 'in',
            fn: function(a, b) {
                return a() in b();
            },
            precedence: 11
        }
    },
    '===': {
        binary: {
            name: 'exactlyEqual',
            fn: function(a, b) {
                return a() === b();
            },
            precedence: 10
        }
    },
    '!==': {
        binary: {
            name: 'notExactlyEqual',
            fn: function(a, b) {
                return a() !== b();
            },
            precedence: 10
        }
    },
    '==': {
        binary: {
            name: 'equal',
            fn: function(a, b) {
                return a() == b();
            },
            precedence: 10
        }
    },
    '!=': {
        binary: {
            name: 'notEqual',
            fn: function(a, b) {
                return a() != b();
            },
            precedence: 10
        }
    },
    '>=': {
        binary: {
            name: 'greaterThanOrEqual',
            fn: function(a, b) {
                return a() >= b();
            },
            precedence: 11
        }
    },
    '<=': {
        binary: {
            name: 'lessThanOrEqual',
            fn: function(a, b) {
                return a() <= b();
            },
            precedence: 11
        }
    },
    '>': {
        binary: {
            name: 'greaterThan',
            fn: function(a, b) {
                return a() > b();
            },
            precedence: 11
        }
    },
    '<': {
        binary: {
            name: 'lessThan',
            fn: function(a, b) {
                return a() < b();
            },
            precedence: 11
        }
    },
    '&&': {
        binary: {
            name: 'and',
            fn: function(a, b) {
                return a() && b();
            },
            precedence: 6
        }
    },
    '||': {
        binary: {
            name: 'or',
            fn: function(a, b) {
                return a() || b();
            },
            precedence: 5
        }
    },
    '!': {
        unary: {
            name: 'not',
            direction: 'right',
            fn: function(a) {
                return !a();
            },
            precedence: 15
        }
    },
    '&': {
        binary: {
            name: 'bitwiseAnd',
            fn: function(a, b) {
                return a() & b();
            },
            precedence: 9
        }
    },
    '^': {
        binary: {
            name: 'bitwiseXOr',
            fn: function(a, b) {
                return a() ^ b();
            },
            precedence: 8
        }
    },
    '|': {
        binary: {
            name: 'bitwiseOr',
            fn: function(a, b) {
                return a() | b();
            },
            precedence: 7
        }
    },
    '~': {
        unary: {
            name: 'bitwiseNot',
            direction: 'right',
            fn: function(a) {
                return ~a();
            },
            precedence: 15
        }
    },
    'typeof': {
        unary: {
            name: 'typeof',
            direction: 'right',
            fn: function(a) {
                return typeof a();
            },
            precedence: 15
        }
    },
    '<<': {
        binary: {
            name: 'bitwiseLeftShift',
            fn: function(a, b) {
                return a() << b();
            },
            precedence: 12
        }
    },
    '>>': {
        binary: {
            name: 'bitwiseRightShift',
            fn: function(a, b) {
                return a() >> b();
            },
            precedence: 12
        }
    },
    '>>>': {
        binary: {
            name: 'bitwiseUnsignedRightShift',
            fn: function(a, b) {
                return a() >>> b();
            },
            precedence: 12
        }
    },
    '?': {
        trinary: {
            name: 'ternary',
            trinary: 'tuple',
            associativity: 'right',
            precedence: 4
        }
    },
    ':': {
        binary: {
            name: 'tuple',
            precedence: 3
        }
    }
};
},{}],37:[function(require,module,exports){
var operators = require('./operators'),
    template = require('string-template'),
    errorTemplate = 'Parse error,\n{message},\nAt {index} "{snippet}"',
    snippetTemplate = '-->{0}<--';

function parseError(message, token){
    var start = Math.max(token.index - 50, 0),
        errorIndex = Math.min(50, token.index),
        surroundingSource = token.sourceRef.source.slice(start, token.index + 50),
        errorMessage = template(errorTemplate, {
            message: message,
            index: token.index,
            snippet: [
                (start === 0 ? '' : '...\n'),
                surroundingSource.slice(0, errorIndex),
                template(snippetTemplate, surroundingSource.slice(errorIndex, errorIndex+1)),
                surroundingSource.slice(errorIndex + 1) + '',
                (surroundingSource.length < 100 ? '' : '...')
            ].join('')
        });

    throw errorMessage;
}

function findNextNonDelimiter(tokens){
    var result;

    while(result = tokens.shift()){
        if(!result || result.type !== 'delimiter'){
            return result;
        }
    }
}

function lastTokenMatches(ast, types, pop){
    var lastToken = ast[ast.length - 1],
        lastTokenType,
        matched;

    if(!lastToken){
        return;
    }

    lastTokenType = lastToken.type;

    for (var i = types.length-1, type = types[i]; i >= 0; i--, type = types[i]) {
        if(type === '!' + lastTokenType){
            return;
        }

        if(type === '*' || type === lastTokenType){
            matched = true;
        }
    }

    if(!matched){
        return;
    }

    if(pop){
        ast.pop();
    }
    return lastToken;
}

function parseIdentifier(tokens, ast){
    if(tokens[0].type === 'word'){
        ast.push({
            type: 'identifier',
            name: tokens.shift().source
        });
        return true;
    }
}

function parseNumber(tokens, ast){
    if(tokens[0].type === 'number'){
        ast.push({
            type: 'number',
            value: parseFloat(tokens.shift().source)
        });
        return true;
    }
}

function functionCall(target, content){
    return {
        type: 'functionCall',
        target: target,
        content: content
    };
}

function parseParenthesis(tokens, ast) {
    if(tokens[0].type !== 'parenthesisOpen'){
        return;
    }

    var openToken = tokens[0],
        position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'parenthesisOpen') {
            opens++;
        }
        if(tokens[position].type === 'parenthesisClose') {
            opens--;
        }
    }

    var target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!statement', '!operator', '!set'], true),
        content = parse(tokens.splice(0, position).slice(1,-1)),
        astNode;

    if(target){
        astNode = functionCall(target, content);
    }else{
        astNode = {
            type: 'parenthesisGroup',
            content: content
        };
    }

    ast.push(astNode);

    return true;
}

function parseParameters(functionCall){
    return functionCall.content.map(function(token){
        if(token.type === 'identifier' || (token.name === 'spread' && token.right.type === 'identifier')){
            return token;
        }

        parseError('Unexpected token in parameter list', functionCall);
    });
}

function namedFunctionExpression(functionCall, content){
    if(functionCall.target.type !== 'identifier'){
        return false;
    }

    return {
        type: 'functionExpression',
        identifier: functionCall.target,
        parameters: parseParameters(functionCall),
        content: content
    };
}

function anonymousFunctionExpression(parenthesisGroup, content){
    return {
        type: 'functionExpression',
        parameters: parseParameters(parenthesisGroup),
        content: content
    };
}

function parseBlock(tokens, ast){
    if(tokens[0].type !== 'braceOpen'){
        return;
    }

    var position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'braceOpen'){
            opens++;
        }
        if(tokens[position].type === 'braceClose'){
            opens--;
        }
    }

    var targetToken = tokens[0],
        content = parse(tokens.splice(0, position).slice(1,-1));

    var functionCall = lastTokenMatches(ast, ['functionCall'], true),
        parenthesisGroup = lastTokenMatches(ast, ['parenthesisGroup'], true),
        astNode;

    if(functionCall){
        astNode = namedFunctionExpression(functionCall, content);
    }else if(parenthesisGroup){
        astNode = anonymousFunctionExpression(parenthesisGroup, content);
    }else{
        astNode = {
            type: 'braceGroup',
            content: content
        };
    }

    if(!astNode){
        parseError('unexpected token.', targetToken);
    }

    ast.push(astNode);

    return true;
}

function parseSet(tokens, ast) {
    if(tokens[0].type !== 'squareBraceOpen'){
        return;
    }

    var openToken = tokens[0],
        position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'squareBraceOpen') {
            opens++;
        }
        if(tokens[position].type === 'squareBraceClose') {
            opens--;
        }
    }

    var content = parse(tokens.splice(0, position).slice(1,-1)),
        target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!functionExpression', '!braceGroup', '!statement', '!operator'], true);

    if(target){
        ast.push({
            type: 'accessor',
            target: target,
            content: content
        });

        return true;
    }

    ast.push({
        type: 'set',
        content: content
    });

    return true;
}


function parseDelimiters(tokens){
    if(tokens[0].type === 'delimiter'){
        tokens.splice(0,1);
        if(tokens[0]){
            tokens[0].delimiterPrefix = true;
        }
        return true;
    }
}

function parseComments(tokens){
    if(tokens[0].type === 'comment'){
        tokens.shift();
        return true;
    }
}

function parseOperator(tokens, ast){
    if(tokens[0].type === 'operator'){
        var token = tokens.shift(),
            operatorsForSource = operators[token.source],
            startOfStatement = !lastTokenMatches(ast, ['*', '!statement', '!operator']);

        if(operatorsForSource.binary && !startOfStatement &&
            !(
                operatorsForSource.unary &&
                (
                    token.delimiterPrefix &&
                    tokens[0].type !== 'delimiter'
                )
            )
        ){
            ast.push({
                type: 'operator',
                name: operatorsForSource.binary.name,
                operator: operatorsForSource.binary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }

        if(operatorsForSource.unary){
            ast.push({
                type: 'operator',
                name: operatorsForSource.unary.name,
                operator: operatorsForSource.unary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }


        if(operatorsForSource.trinary && !startOfStatement){
            ast.push({
                type: 'operator',
                name: operatorsForSource.trinary.name,
                operator: operatorsForSource.trinary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }

        parseError('Unexpected token', token);
    }
}

function parsePeriod(tokens, ast){
    if(tokens[0].type === 'period'){
        var token = tokens.shift(),
            right = findNextNonDelimiter(tokens);

        if(!right){
            return parseError('Unexpected token', token);
        }

        ast.push({
            type: 'period',
            left: ast.pop(),
            right: parseToken([right]).pop()
        });

        return true;
    }
}

function parseString(tokens, ast){
    if(tokens[0].type === 'string'){
        ast.push({
            type: 'string',
            value: tokens.shift().source.slice(1,-1)
        });
        return true;
    }
}

function parseSemicolon(tokens, ast){
    if(tokens[0].type === 'semicolon'){
        tokens.shift();
        ast.push({
            type: 'statement',
            content: [ast.pop()]
        });
        return true;
    }
}

var parsers = [
    parseDelimiters,
    parseComments,
    parseNumber,
    parseString,
    parseIdentifier,
    parsePeriod,
    parseParenthesis,
    parseSet,
    parseBlock,
    parseOperator,
    parseSemicolon
];

function parseOperators(ast){
    ast.filter(function(token){
        return token.type === 'operator';
    })
    .sort(function(a,b){
        if(a.operator.precedence === b.operator.precedence && a.operator.associativity === 'right'){
            return 1;
        }

        return b.operator.precedence - a.operator.precedence;
    })
    .forEach(function(token){
        var index = ast.indexOf(token),
            operator = token.operator,
            left,
            middle,
            right;

        // Token was parsed by some other parser step.
        if(!~index){
            return;
        }

        if(operator.trinary){
            left = ast.splice(index-1,1);
            middle = ast.splice(index,1);
            var trinary = ast.splice(index,1);
            right = ast.splice(index,1);
            if(!trinary.length || trinary[0].name !== operator.trinary){
                parseError('Unexpected token.', token);
            }
        }else if(operator.direction === 'left'){
            left = ast.splice(index-1,1);
        }else if(operator.direction === 'right'){
            right = ast.splice(index + 1,1);
        }else{
            left = ast.splice(index-1,1);
            right = ast.splice(index, 1);
        }

        if(
            left && left.length !== 1 ||
            middle && middle.length !== 1 ||
            right && right.length !== 1
        ){
            parseError('unexpected token.', token);
        }

        if(left){
            token.left = left[0];
        }
        if(middle){
            token.middle = middle[0];
        }
        if(right){
            token.right = right[0];
        }
    });
}

function parseToken(tokens, ast){
    if(!ast){
        ast = [];
    }

    for(var i = 0; i <= parsers.length && tokens.length; i++){
        if(i === parsers.length && tokens.length){
            parseError('unknown token', tokens[0]);
            return;
        }

        if(parsers[i](tokens, ast)){
            return ast;
        }
    }
}

function parse(tokens, mutate){
    var ast = [];

    if(!mutate){
        tokens = tokens.slice();
    }

    while(tokens.length){
        parseToken(tokens, ast);
    }

    parseOperators(ast);

    return ast;
}

module.exports = parse;
},{"./operators":36,"string-template":43}],38:[function(require,module,exports){
var toValue = require('./toValue');

function wrapScope(__scope__){
    var scope = new Scope();
    scope.__scope__ = __scope__;
    return scope;
}

function Scope(oldScope, debug){
    this.__scope__ = {};
    this._debug = debug;
    if(oldScope){
        this.__outerScope__ = oldScope instanceof Scope ? oldScope : wrapScope(oldScope);
        this._debug = this.__outerScope__._debug;
    }
}
Scope.prototype.throw = function(message){
    this._error = new Error('Presh execution error: ' + message);
    this._error.scope = this;
};
Scope.prototype.get = function(key){
    var scope = this;
    while(scope && !scope.__scope__.hasOwnProperty(key)){
        scope = scope.__outerScope__;
    }
    return scope && toValue.value(scope.__scope__[key], this);
};
Scope.prototype.set = function(key, value, bubble){
    if(bubble){
        var currentScope = this;
        while(currentScope && !(key in currentScope.__scope__)){
            currentScope = currentScope.__outerScope__;
        }

        if(currentScope){
            currentScope.set(key, value);
        }
    }
    this.__scope__[key] = toValue(value, this);
    return this;
};
Scope.prototype.define = function(obj){
    for(var key in obj){
        this.__scope__[key] = toValue(obj[key], this);
    }
    return this;
};
Scope.prototype.isDefined = function(key){
    if(key in this.__scope__){
        return true;
    }
    return this.__outerScope__ && this.__outerScope__.isDefined(key) || false;
};
Scope.prototype.hasError = function(){
    return this._error;
};

module.exports = Scope;
},{"./toValue":39}],39:[function(require,module,exports){
var v = {};

function isValue(value){
    return value && value._value === v;
}

module.exports = function toValue(value, scope, context){
    if(scope._error){
        return {
            error: scope._error
        };
    }

    if(isValue(value)){
        if(typeof context === 'object' || typeof context === 'function'){
            value.context = context;
        }
        return value;
    }

    return {
        type: 'value',
        context: context,
        value: value,
        _value: v
    };
};

module.exports.isValue = isValue;

module.exports.value = function(value){
    return isValue(value) ? value.value : value;
};
},{}],40:[function(require,module,exports){
module.exports = function isSame(a, b){
    if(a === b){
        return true;
    }

    if(
        typeof a !== typeof b ||
        typeof a === 'object' &&
        !(a instanceof Date && b instanceof Date)
    ){
        return false;
    }

    return String(a) === String(b);
};
},{}],41:[function(require,module,exports){
var naturalSelection = require('natural-selection');

module.exports = function(element, value){
    var canSet = naturalSelection(element) && element === document.activeElement;

    if (canSet) {
        var start = element.selectionStart,
            end = element.selectionEnd;

        element.value = value;
        element.setSelectionRange(start, end);
    } else {
        element.value = value;
    }
};

},{"natural-selection":31}],42:[function(require,module,exports){
'use strict'
/* eslint no-proto: 0 */
module.exports = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array ? setProtoOf : mixinProperties)

function setProtoOf (obj, proto) {
  obj.__proto__ = proto
  return obj
}

function mixinProperties (obj, proto) {
  for (var prop in proto) {
    if (!obj.hasOwnProperty(prop)) {
      obj[prop] = proto[prop]
    }
  }
  return obj
}

},{}],43:[function(require,module,exports){
var nargs = /\{([0-9a-zA-Z]+)\}/g
var slice = Array.prototype.slice

module.exports = template

function template(string) {
    var args

    if (arguments.length === 2 && typeof arguments[1] === "object") {
        args = arguments[1]
    } else {
        args = slice.call(arguments, 1)
    }

    if (!args || !args.hasOwnProperty) {
        args = {}
    }

    return string.replace(nargs, function replaceArg(match, i, index) {
        var result

        if (string[index - 1] === "{" &&
            string[index + match.length] === "}") {
            return i
        } else {
            result = args.hasOwnProperty(i) ? args[i] : null
            if (result === null || result === undefined) {
                return ""
            }

            return result
        }
    })
}

},{}],44:[function(require,module,exports){
var clone = require('clone'),
    deepEqual = require('cyclic-deep-equal');

function keysAreDifferent(keys1, keys2){
    if(keys1 === keys2){
        return;
    }
    if(!keys1 || !keys2 || keys1.length !== keys2.length){
        return true;
    }
    for(var i = 0; i < keys1.length; i++){
        if(keys1[i] !== keys2[i]){
            return true;
        }
    }
}

function getKeys(value){
    if(!value || typeof value !== 'object'){
        return;
    }

    return Object.keys(value);
}

function WhatChanged(value, changesToTrack){
    this._changesToTrack = {};

    if(changesToTrack == null){
        changesToTrack = 'value type keys structure reference';
    }

    if(typeof changesToTrack !== 'string'){
        throw 'changesToTrack must be of type string';
    }

    changesToTrack = changesToTrack.split(' ');

    for (var i = 0; i < changesToTrack.length; i++) {
        this._changesToTrack[changesToTrack[i]] = true;
    };

    this.update(value);
}
WhatChanged.prototype.update = function(value){
    var result = {},
        changesToTrack = this._changesToTrack,
        newKeys = getKeys(value);

    if('value' in changesToTrack && value+'' !== this._lastReference+''){
        result.value = true;
        result.any = true;
    }
    if(
        'type' in changesToTrack && typeof value !== typeof this._lastValue ||
        (value === null || this._lastValue === null) && this.value !== this._lastValue // typeof null === 'object'
    ){
        result.type = true;
        result.any = true;
    }
    if('keys' in changesToTrack && keysAreDifferent(this._lastKeys, getKeys(value))){
        result.keys = true;
        result.any = true;
    }

    if(value !== null && typeof value === 'object' || typeof value === 'function'){
        var lastValue = this._lastValue;

        if('shallowStructure' in changesToTrack && (!lastValue || typeof lastValue !== 'object' || Object.keys(value).some(function(key, index){
            return value[key] !== lastValue[key];
        }))){
            result.shallowStructure = true;
            result.any = true;
        }
        if('structure' in changesToTrack && !deepEqual(value, lastValue)){
            result.structure = true;
            result.any = true;
        }
        if('reference' in changesToTrack && value !== this._lastReference){
            result.reference = true;
            result.any = true;
        }
    }

    this._lastValue = 'structure' in changesToTrack ? clone(value) : 'shallowStructure' in changesToTrack ? clone(value, true, 1): value;
    this._lastReference = value;
    this._lastKeys = newKeys;

    return result;
};

module.exports = WhatChanged;
},{"clone":8,"cyclic-deep-equal":10}],45:[function(require,module,exports){
var operatorTokens = require('presh/operators');
var operatorMap = Object.keys(operatorTokens).reduce(function(result, operatorSource){
    var operators = operatorTokens[operatorSource];

    Object.keys(operators).forEach(operatorType => {
        var operator = operators[operatorType];
        result[operator.name] = operator;
        result[operator.name].source = operatorSource
    });

    return result;
}, {});
var lex = require('presh/lex');
var parse = require('presh/parse');
var execute = require('presh/execute');
var Scope = require('presh/scope');
var globals = require('presh/global');

function executeToken(token, data){
    if(!token){
        return;
    }

    var executionResult = execute([token], { ...globals, ...data.globals });
    if(executionResult.error){
        return executionResult.error;
    }
    var result = executionResult.value;

    if(data.resultTransform){
        result = data.resultTransform(result, token, { ...globals, ...data.globals });
    }

    return result;
}

function titleBinding(fastn, scope, static){
    if(static){
        return;
    }
    return fastn.binding('item|**', fastn.binding('.|**').attach(scope), executeToken)
}

function onNodeInput(binding){
    return function(event, scope){
        var existingNode = scope.get('item');
        try {
            var newNode = parse(lex(event.target.textContent))[0];
        } catch (error) {
            scope.set('item.error', error);
            return;
        }
        binding(newNode);
    }
}

function onNodeAction(scope, token){
    return function(event, componentScope) {
        var nodeAction = scope.get('nodeAction');
        if(nodeAction){
            nodeAction(event, this, componentScope, token)
        }
    }
}

function renderFunctionExpression(fastn, scope, binding, static){
    return fastn('templater', {
        data: fastn.binding('item'),
        attachTemplates: false,
        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            return fastn('div',
                {
                    class: 'node functionExpression',
                    result: titleBinding(fastn, scope, static),
                    //contenteditable: fastn.binding('edit').attach(scope)
                },
                fastn.binding('item.identifier.name'),
                '(',
                fastn('list:span', {
                    items: fastn.binding('item.parameters'),
                    template: () => fastn('span', { class: 'node literal' }, fastn.binding('item.name'))
                }),
                ')',
                '{',
                renderNodeList(fastn, scope, true).binding('item'),
                '}'
            )
            .on('input', onNodeInput(binding))
            .on('click', onNodeAction(scope, token));
        }
    })
}

function renderFunctionCall(fastn, scope, binding, static){
    return fastn('templater', {
        data: fastn.binding('item'),
        attachTemplates: false,
        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            return fastn('div',
                {
                    class: 'node functionCall',
                    result: titleBinding(fastn, scope, static),
                    //contenteditable: fastn.binding('edit').attach(scope)
                },
                renderNode(fastn, scope, fastn.binding('item.target'), static),
                fastn.binding('item.target.name'),
                fastn('span', { class: 'parenthesis open' }, '('),
                renderNodeList(fastn, scope, static).binding('item'),
                fastn('span', { class: 'parenthesis close' },')')
            )
            .on('input', onNodeInput(binding))
            .on('click', onNodeAction(scope, token));
        }
    })
}

function renderOperator(fastn, scope, binding, static){
    return fastn('templater', {
        data: fastn.binding('item'),
        attachTemplates: false,
        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            return fastn('div',
                {
                    class: 'node operator',
                    result: titleBinding(fastn, scope, static),
                    //contenteditable: fastn.binding('edit').attach(scope)
                },
                token.left && renderNode(fastn, scope, fastn.binding('item.left'), static),
                ' ',
                fastn('span', { 'class': 'symbol' }, operatorMap[token.operator.name].source),
                ' ',
                token.middle && renderNode(fastn, scope, fastn.binding('item.middle'), static),
                token.middle && ' : ',
                token.right && renderNode(fastn, scope, fastn.binding('item.right'), static)
            )
            .on('input', onNodeInput(binding))
            .on('click', onNodeAction(scope, token));
        }
    })
}

function renderNumber(fastn, scope, binding){
    return fastn('div',
        {
            class: 'literal node',
            //contenteditable: fastn.binding('edit').attach(scope)
        },
        fastn.binding('item.value')
    )
    .on('input', onNodeInput(binding));
}

function renderIdentifier(fastn, scope, binding, static){
    return fastn('div',
        {
            class: 'node identifier',
            //contenteditable: fastn.binding('edit').attach(scope),
            result: titleBinding(fastn, scope, static)
        },
        fastn.binding('item.name')
    )
    .on('input', onNodeInput(binding));
}

function renderPeriod(fastn, scope, binding, static){
    return fastn('div',
        {
            class: 'node period',
            //contenteditable: fastn.binding('edit').attach(scope),
            result: titleBinding(fastn, scope, static)
        },
        renderNode(fastn, scope, fastn.binding('item.left'), static),
        '.',
        renderNode(fastn, scope, fastn.binding('item.right'), static)
    )
    .on('input', onNodeInput(binding));
}

function renderParentesisGroup(fastn, scope, binding, static){
    return fastn('div',
        {
            class: 'node group',
            //contenteditable: fastn.binding('edit').attach(scope),
            result: titleBinding(fastn, scope, static)
        },
        fastn('span', { class: 'parenthesis open' }, '('),
        renderNodeList(fastn, scope, static).binding('item'),
        fastn('span', { class: 'parenthesis close' }, ')')
    )
    .on('input', onNodeInput(binding));
}

var nodeTypeRenderers = {
    functionExpression: renderFunctionExpression,
    functionCall: renderFunctionCall,
    operator: renderOperator,
    number: renderNumber,
    identifier: renderIdentifier,
    parenthesisGroup: renderParentesisGroup,
    period: renderPeriod
};

function renderNode(fastn, scope, binding, static){
    return fastn('templater', {
        data: binding,
        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            return nodeTypeRenderers[token.type](fastn, scope, binding, static)
                .on('click', onNodeAction(scope, token));
        }
    })
}

function renderNodeList(fastn, scope, static){
    return fastn('list:span', {
        class: 'content',
        items: fastn.binding('content|*'),
        template: () => renderNode(fastn, scope, fastn.binding('item'), static)
    })
}

module.exports = function(fastn, component, type, settings, children, createInternalScope){
    settings.tagName = component._tagName || 'pre';

    component.extend('_generic', settings, children);

    var { binding, model } = createInternalScope({
        resultTransform: null,
        nodeAction: null,
        content: [],
        source: '',
        globals: {}
    }, {});

    function updateTokens(){
        var lexed = lex(model.get('source'));
        var parsed = parse(lexed);

        model.update('content', parsed, { strategy: 'morph' });
    }

    model.on('source', updateTokens);

    component.insert(renderNodeList(fastn, model).attach(model));
    component.on('render', () => {
        component.element.classList.add('preshExplorer');
    });

    return component;
}
},{"presh/execute":33,"presh/global":34,"presh/lex":35,"presh/operators":36,"presh/parse":37,"presh/scope":38}]},{},[3])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIuLi9lbnRpL25vZGVfbW9kdWxlcy9lbnRpL2luZGV4LmpzIiwiLi4vZW50aS9ub2RlX21vZHVsZXMvaXMtaW5zdGFuY2UvaW5kZXguanMiLCJleGFtcGxlL2luZGV4LmpzIiwiaW5kZXguanMiLCJub2RlX21vZHVsZXMvYmFzZTY0LWpzL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9jbGFzc2lzdC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9jbG9uZS9jbG9uZS5qcyIsIm5vZGVfbW9kdWxlcy9jcmVsL2NyZWwuanMiLCJub2RlX21vZHVsZXMvY3ljbGljLWRlZXAtZXF1YWwvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZXZlbnRzL2V2ZW50cy5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9iYXNlQ29tcG9uZW50LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL2JpbmRpbmcuanMiLCJub2RlX21vZHVsZXMvZmFzdG4vY29udGFpbmVyQ29tcG9uZW50LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL2RvbUNvbXBvbmVudHMuanMiLCJub2RlX21vZHVsZXMvZmFzdG4vZmFuY3lQcm9wcy5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9maXJtZXIuanMiLCJub2RlX21vZHVsZXMvZmFzdG4vZ2VuZXJpY0NvbXBvbmVudC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9pcy5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi9saXN0Q29tcG9uZW50LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL3Byb3BlcnR5LmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL3NjaGVkdWxlLmpzIiwibm9kZV9tb2R1bGVzL2Zhc3RuL3RlbXBsYXRlckNvbXBvbmVudC5qcyIsIm5vZGVfbW9kdWxlcy9mYXN0bi90ZXh0Q29tcG9uZW50LmpzIiwibm9kZV9tb2R1bGVzL2ZsYXQtbWVyZ2UvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZnVuY3Rpb24tZW1pdHRlci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL211bHRpbWFwL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25hdHVyYWwtc2VsZWN0aW9uL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL29iamVjdC1hc3NpZ24vaW5kZXguanMiLCJub2RlX21vZHVsZXMvcHJlc2gvZXhlY3V0ZS5qcyIsIm5vZGVfbW9kdWxlcy9wcmVzaC9nbG9iYWwuanMiLCJub2RlX21vZHVsZXMvcHJlc2gvbGV4LmpzIiwibm9kZV9tb2R1bGVzL3ByZXNoL29wZXJhdG9ycy5qcyIsIm5vZGVfbW9kdWxlcy9wcmVzaC9wYXJzZS5qcyIsIm5vZGVfbW9kdWxlcy9wcmVzaC9zY29wZS5qcyIsIm5vZGVfbW9kdWxlcy9wcmVzaC90b1ZhbHVlLmpzIiwibm9kZV9tb2R1bGVzL3NhbWUtdmFsdWUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvc2V0aWZ5L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3NldHByb3RvdHlwZW9mL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3N0cmluZy10ZW1wbGF0ZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy93aGF0LWNoYW5nZWQvaW5kZXguanMiLCJwcmVzaEV4cGxvcmVyQ29tcG9uZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzd1QkE7QUFDQTtBQUNBOztBQ0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDdkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNqdkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDbERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN0S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM2dCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9HQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6TkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ2xOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN1NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCJ2YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyLFxyXG4gICAgaXNJbnN0YW5jZSA9IHJlcXVpcmUoJ2lzLWluc3RhbmNlJyk7XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVQb29sKGdyb3dTaXplLCBjcmVhdGUsIGRpc3Bvc2Upe1xyXG4gICAgdmFyIHBvb2wgPSBbXTtcclxuICAgIHZhciBpbmRleCA9IC0xO1xyXG4gICAgdmFyIHRvdGFsQ3JlYXRlZCA9IDA7XHJcbiAgICB2YXIgdG90YWxEaXNwb3NlZCA9IDA7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBzaXplOiBmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICByZXR1cm4gcG9vbC5sZW5ndGg7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBjcmVhdGVkOiBmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICByZXR1cm4gdG90YWxDcmVhdGVkO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZGlzcG9zZWQ6IGZ1bmN0aW9uKCl7XHJcbiAgICAgICAgICAgIHJldHVybiB0b3RhbERpc3Bvc2VkO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICBpZihpbmRleCA+PSAwKXtcclxuICAgICAgICAgICAgICAgIHZhciBpdGVtID0gcG9vbFtpbmRleF07XHJcbiAgICAgICAgICAgICAgICBwb29sW2luZGV4XSA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICBpbmRleC0tO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGl0ZW07XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRvdGFsQ3JlYXRlZCsrO1xyXG4gICAgICAgICAgICByZXR1cm4gY3JlYXRlKCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBkaXNwb3NlOiBmdW5jdGlvbihvYmplY3Qpe1xyXG4gICAgICAgICAgICB0b3RhbERpc3Bvc2VkKys7XHJcbiAgICAgICAgICAgIGRpc3Bvc2Uob2JqZWN0KTtcclxuICAgICAgICAgICAgaWYoaW5kZXggPj0gcG9vbC5sZW5ndGgpe1xyXG4gICAgICAgICAgICAgICAgcG9vbCA9IHBvb2wuY29uY2F0KG5ldyBBcnJheShncm93U2l6ZSkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGluZGV4Kys7XHJcbiAgICAgICAgICAgIHBvb2xbaW5kZXhdID0gb2JqZWN0O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxudmFyIHNldFBvb2wgPSBjcmVhdGVQb29sKDEwMDAsIGZ1bmN0aW9uKCl7XHJcbiAgICByZXR1cm4gbmV3IFNldCgpO1xyXG59LCBmdW5jdGlvbihzZXQpe1xyXG4gICAgc2V0LmNsZWFyKCk7XHJcbn0pO1xyXG5cclxudmFyIGVtaXRLZXlQb29sID0gY3JlYXRlUG9vbCgxMCwgZnVuY3Rpb24oKXtcclxuICAgIHJldHVybiBuZXcgTWFwKCk7XHJcbn0sIGZ1bmN0aW9uKGVtaXRLZXkpe1xyXG4gICAgZW1pdEtleS5mb3JFYWNoKHNldFBvb2wuZGlzcG9zZSk7XHJcbiAgICBlbWl0S2V5LmNsZWFyKCk7XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gdG9BcnJheShpdGVtcyl7XHJcbiAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoaXRlbXMpO1xyXG59XHJcblxyXG52YXIgZGVlcFJlZ2V4ID0gL1t8Ll0vaTtcclxuXHJcbmZ1bmN0aW9uIG1hdGNoRGVlcChwYXRoKXtcclxuICAgIHJldHVybiAocGF0aCArICcnKS5tYXRjaChkZWVwUmVnZXgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1dpbGRjYXJkUGF0aChwYXRoKXtcclxuICAgIHZhciBzdHJpbmdQYXRoID0gKHBhdGggKyAnJyk7XHJcbiAgICByZXR1cm4gfnN0cmluZ1BhdGguaW5kZXhPZignKicpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRUYXJnZXRLZXkocGF0aCl7XHJcbiAgICB2YXIgc3RyaW5nUGF0aCA9IChwYXRoICsgJycpO1xyXG4gICAgcmV0dXJuIHN0cmluZ1BhdGguc3BsaXQoJ3wnKS5zaGlmdCgpO1xyXG59XHJcblxyXG52YXIgZXZlbnRTeXN0ZW1WZXJzaW9uID0gMSxcclxuICAgIGdsb2JhbEtleSA9ICdfZW50aUV2ZW50U3RhdGUnICsgZXZlbnRTeXN0ZW1WZXJzaW9uLFxyXG4gICAgZ2xvYmFsU3RhdGUgPSBnbG9iYWxbZ2xvYmFsS2V5XSA9IGdsb2JhbFtnbG9iYWxLZXldIHx8IHtcclxuICAgICAgICBpbnN0YW5jZXM6IFtdLFxyXG4gICAgICAgIGdldFBvb2xJbmZvOiBmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICByZXR1cm4gW1xyXG4gICAgICAgICAgICAgICAgJ3NldFBvb2wnLCBzZXRQb29sLnNpemUoKSxcclxuICAgICAgICAgICAgICAgICdjcmVhdGVkJywgc2V0UG9vbC5jcmVhdGVkKCksXHJcbiAgICAgICAgICAgICAgICAnZGlzcG9zZWQnLCBzZXRQb29sLmRpc3Bvc2VkKCksXHJcbiAgICAgICAgICAgICAgICAnZW1pdEtleVBvb2wnLCBlbWl0S2V5UG9vbC5zaXplKCksXHJcbiAgICAgICAgICAgICAgICAnY3JlYXRlZCcsIGVtaXRLZXlQb29sLmNyZWF0ZWQoKSxcclxuICAgICAgICAgICAgICAgICdkaXNwb3NlZCcsIGVtaXRLZXlQb29sLmRpc3Bvc2VkKClcclxuICAgICAgICAgICAgXTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxudmFyIG1vZGlmaWVkRW50aWVzID0gZ2xvYmFsU3RhdGUubW9kaWZpZWRFbnRpZXNfdjYgPSBnbG9iYWxTdGF0ZS5tb2RpZmllZEVudGllc192NiB8fCBzZXRQb29sLmdldCgpLFxyXG4gICAgdHJhY2tlZE9iamVjdHMgPSBnbG9iYWxTdGF0ZS50cmFja2VkT2JqZWN0c192NiA9IGdsb2JhbFN0YXRlLnRyYWNrZWRPYmplY3RzX3Y2IHx8IG5ldyBXZWFrTWFwKCk7XHJcbiAgICB0cmFja2VkSGFuZGxlcnMgPSBnbG9iYWxTdGF0ZS50cmFja2VkSGFuZGxlcnNfdjYgPSBnbG9iYWxTdGF0ZS50cmFja2VkSGFuZGxlcnNfdjYgfHwgbmV3IFdlYWtNYXAoKTtcclxuXHJcbmZ1bmN0aW9uIGxlZnRBbmRSZXN0KHBhdGgpe1xyXG4gICAgdmFyIHN0cmluZ1BhdGggPSAocGF0aCArICcnKTtcclxuXHJcbiAgICAvLyBTcGVjaWFsIGNhc2Ugd2hlbiB5b3Ugd2FudCB0byBmaWx0ZXIgb24gc2VsZiAoLilcclxuICAgIGlmKHN0cmluZ1BhdGguc2xpY2UoMCwyKSA9PT0gJy58Jyl7XHJcbiAgICAgICAgcmV0dXJuIFsnLicsIHN0cmluZ1BhdGguc2xpY2UoMildO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBtYXRjaCA9IG1hdGNoRGVlcChzdHJpbmdQYXRoKTtcclxuICAgIGlmKG1hdGNoKXtcclxuICAgICAgICByZXR1cm4gW3N0cmluZ1BhdGguc2xpY2UoMCwgbWF0Y2guaW5kZXgpLCBzdHJpbmdQYXRoLnNsaWNlKG1hdGNoLmluZGV4KzEpXTtcclxuICAgIH1cclxuICAgIHJldHVybiBzdHJpbmdQYXRoO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1dpbGRjYXJkS2V5KGtleSl7XHJcbiAgICByZXR1cm4ga2V5LmNoYXJBdCgwKSA9PT0gJyonO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0ZlcmFsY2FyZEtleShrZXkpe1xyXG4gICAgcmV0dXJuIGtleSA9PT0gJyoqJztcclxufVxyXG5cclxuZnVuY3Rpb24gYWRkSGFuZGxlcihvYmplY3QsIGtleSwgaGFuZGxlciwgcGFyZW50SGFuZGxlcil7XHJcbiAgICB2YXIgdHJhY2tlZEtleXMgPSB0cmFja2VkT2JqZWN0cy5nZXQob2JqZWN0KTtcclxuICAgIHZhciB0cmFja2VkSGFuZGxlciA9IHRyYWNrZWRIYW5kbGVycy5nZXQocGFyZW50SGFuZGxlcik7XHJcblxyXG4gICAgaWYodHJhY2tlZEtleXMgPT0gbnVsbCl7XHJcbiAgICAgICAgdHJhY2tlZEtleXMgPSB7fTtcclxuICAgICAgICB0cmFja2VkT2JqZWN0cy5zZXQob2JqZWN0LCB0cmFja2VkS2V5cyk7XHJcbiAgICB9XHJcbiAgICBpZih0cmFja2VkSGFuZGxlciA9PSBudWxsKXtcclxuICAgICAgICB0cmFja2VkSGFuZGxlciA9IG5ldyBXZWFrTWFwKCk7XHJcbiAgICAgICAgdHJhY2tlZEhhbmRsZXJzLnNldChwYXJlbnRIYW5kbGVyLCBuZXcgV2Vha01hcCgpKTtcclxuICAgIH1cclxuXHJcbiAgICBpZih0cmFja2VkSGFuZGxlci5nZXQob2JqZWN0KSA9PSBudWxsKXtcclxuICAgICAgICB0cmFja2VkSGFuZGxlci5zZXQob2JqZWN0LCBzZXRQb29sLmdldCgpKTtcclxuICAgIH1cclxuXHJcbiAgICBpZih0cmFja2VkSGFuZGxlci5nZXQob2JqZWN0KS5oYXMoa2V5KSl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XHJcblxyXG4gICAgaWYoIWhhbmRsZXJzKXtcclxuICAgICAgICBoYW5kbGVycyA9IHNldFBvb2wuZ2V0KCk7XHJcbiAgICAgICAgdHJhY2tlZEtleXNba2V5XSA9IGhhbmRsZXJzO1xyXG4gICAgfVxyXG5cclxuICAgIGhhbmRsZXJzLmFkZChoYW5kbGVyKTtcclxuICAgIHRyYWNrZWRIYW5kbGVyLmdldChvYmplY3QpLmFkZChrZXkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW1vdmVIYW5kbGVyKG9iamVjdCwga2V5LCBoYW5kbGVyLCBwYXJlbnRIYW5kbGVyKXtcclxuICAgIHZhciB0cmFja2VkS2V5cyA9IHRyYWNrZWRPYmplY3RzLmdldChvYmplY3QpO1xyXG4gICAgdmFyIHRyYWNrZWRIYW5kbGVyID0gdHJhY2tlZEhhbmRsZXJzLmdldChwYXJlbnRIYW5kbGVyKTtcclxuXHJcbiAgICBpZihcclxuICAgICAgICB0cmFja2VkS2V5cyA9PSBudWxsIHx8XHJcbiAgICAgICAgdHJhY2tlZEhhbmRsZXIgPT0gbnVsbCB8fFxyXG4gICAgICAgIHRyYWNrZWRIYW5kbGVyLmdldChvYmplY3QpID09IG51bGwgfHxcclxuICAgICAgICAhdHJhY2tlZEhhbmRsZXIuZ2V0KG9iamVjdCkuaGFzKGtleSlcclxuICAgICl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBoYW5kbGVycyA9IHRyYWNrZWRLZXlzW2tleV07XHJcblxyXG4gICAgaWYoIWhhbmRsZXJzKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaGFuZGxlcnMuZGVsZXRlKGhhbmRsZXIpO1xyXG4gICAgaWYoaGFuZGxlcnMuc2l6ZSA9PT0gMCl7XHJcbiAgICAgICAgc2V0UG9vbC5kaXNwb3NlKGhhbmRsZXJzKTtcclxuICAgICAgICBkZWxldGUgdHJhY2tlZEtleXNba2V5XTtcclxuICAgIH1cclxuICAgIHZhciB0cmFja2VkT2JqZWN0SGFuZGxlclNldCA9IHRyYWNrZWRIYW5kbGVyLmdldChvYmplY3QpO1xyXG4gICAgdHJhY2tlZE9iamVjdEhhbmRsZXJTZXQuZGVsZXRlKGtleSk7XHJcbiAgICBpZih0cmFja2VkT2JqZWN0SGFuZGxlclNldC5zaXplID09PSAwKXtcclxuICAgICAgICBzZXRQb29sLmRpc3Bvc2UodHJhY2tlZE9iamVjdEhhbmRsZXJTZXQpO1xyXG4gICAgICAgIHRyYWNrZWRIYW5kbGVyLmRlbGV0ZShvYmplY3QpO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiB0cmFja09iamVjdHMoZXZlbnROYW1lLCB0cmFja2VkLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCl7XHJcbiAgICBpZighb2JqZWN0IHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHRhcmdldCA9IG9iamVjdFtrZXldO1xyXG5cclxuICAgIGlmKHRhcmdldCAmJiB0eXBlb2YgdGFyZ2V0ID09PSAnb2JqZWN0JyAmJiB0cmFja2VkLmhhcyh0YXJnZXQpKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdHJhY2tPYmplY3QoZXZlbnROYW1lLCB0cmFja2VkLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRyYWNrS2V5cyhldmVudE5hbWUsIHRyYWNrZWQsIGhhbmRsZXIsIHRhcmdldCwgcm9vdCwgcmVzdCl7XHJcbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKHRhcmdldCk7XHJcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKyl7XHJcbiAgICAgICAgaWYoaXNGZXJhbGNhcmRLZXkocm9vdCkpe1xyXG4gICAgICAgICAgICB0cmFja09iamVjdHMoZXZlbnROYW1lLCB0cmFja2VkLCBoYW5kbGVyLCB0YXJnZXQsIGtleXNbaV0sICcqKicgKyAocmVzdCA/ICcuJyA6ICcnKSArIChyZXN0IHx8ICcnKSk7XHJcbiAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgIHRyYWNrT2JqZWN0cyhldmVudE5hbWUsIHRyYWNrZWQsIGhhbmRsZXIsIHRhcmdldCwga2V5c1tpXSwgcmVzdCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiB0cmFja09iamVjdChldmVudE5hbWUsIHRyYWNrZWQsIGhhbmRsZXIsIG9iamVjdCwga2V5LCBwYXRoKXtcclxuICAgIHZhciBldmVudEtleSA9IGtleSA9PT0gJyoqJyA/ICcqJyA6IGtleSxcclxuICAgICAgICB0YXJnZXQgPSBvYmplY3Rba2V5XSxcclxuICAgICAgICB0YXJnZXRJc09iamVjdCA9IHRhcmdldCAmJiB0eXBlb2YgdGFyZ2V0ID09PSAnb2JqZWN0JztcclxuXHJcbiAgICB2YXIgaGFuZGxlID0gZnVuY3Rpb24oZXZlbnQsIGVtaXRLZXkpe1xyXG4gICAgICAgIGlmKGV2ZW50S2V5ICE9PSAnKicgJiYgdHlwZW9mIG9iamVjdFtldmVudEtleV0gPT09ICdvYmplY3QnICYmIG9iamVjdFtldmVudEtleV0gIT09IHRhcmdldCl7XHJcbiAgICAgICAgICAgIGlmKHRhcmdldElzT2JqZWN0KXtcclxuICAgICAgICAgICAgICAgIHRyYWNrZWQuZGVsZXRlKHRhcmdldCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmVtb3ZlSGFuZGxlcihvYmplY3QsIGV2ZW50S2V5LCBoYW5kbGUsIGhhbmRsZXIpO1xyXG4gICAgICAgICAgICB0cmFja09iamVjdHMoZXZlbnROYW1lLCB0cmFja2VkLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKGV2ZW50S2V5ID09PSAnKicpe1xyXG4gICAgICAgICAgICB0cmFja0tleXMoZXZlbnROYW1lLCB0cmFja2VkLCBoYW5kbGVyLCBvYmplY3QsIGtleSwgcGF0aCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZighdHJhY2tlZC5oYXMob2JqZWN0KSl7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKGtleSAhPT0gJyoqJyB8fCAhcGF0aCl7XHJcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQsIGVtaXRLZXkpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgYWRkSGFuZGxlcihvYmplY3QsIGV2ZW50S2V5LCBoYW5kbGUsIGhhbmRsZXIpO1xyXG5cclxuICAgIGlmKCF0YXJnZXRJc09iamVjdCl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRyYWNrZWQuYWRkKHRhcmdldCk7XHJcblxyXG4gICAgaWYoIXBhdGgpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcm9vdEFuZFJlc3QgPSBsZWZ0QW5kUmVzdChwYXRoKSxcclxuICAgICAgICByb290LFxyXG4gICAgICAgIHJlc3Q7XHJcblxyXG4gICAgaWYoIUFycmF5LmlzQXJyYXkocm9vdEFuZFJlc3QpKXtcclxuICAgICAgICByb290ID0gcm9vdEFuZFJlc3Q7XHJcbiAgICB9ZWxzZXtcclxuICAgICAgICByb290ID0gcm9vdEFuZFJlc3RbMF07XHJcbiAgICAgICAgcmVzdCA9IHJvb3RBbmRSZXN0WzFdO1xyXG5cclxuICAgICAgICAvLyBJZiB0aGUgcm9vdCBpcyAnLicsIHdhdGNoIGZvciBldmVudHMgb24gKlxyXG4gICAgICAgIGlmKHJvb3QgPT09ICcuJyl7XHJcbiAgICAgICAgICAgIHJvb3QgPSAnKic7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmKHRhcmdldElzT2JqZWN0ICYmIGlzV2lsZGNhcmRLZXkocm9vdCkpe1xyXG4gICAgICAgIHRyYWNrS2V5cyhldmVudE5hbWUsIHRyYWNrZWQsIGhhbmRsZXIsIHRhcmdldCwgcm9vdCwgcmVzdCk7XHJcbiAgICB9XHJcblxyXG4gICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgdHJhY2tlZCwgaGFuZGxlciwgdGFyZ2V0LCByb290LCByZXN0KTtcclxufVxyXG5cclxuZnVuY3Rpb24gZW1pdEZvckVudGkodHJhY2tlZFBhdGhzLCB0cmFja2VkT2JqZWN0UGF0aHMsIGV2ZW50TmFtZSwgZW1pdEtleSwgZXZlbnQsIGVudGkpe1xyXG4gICAgdmFyIGVtaXRTZXQgPSBlbWl0S2V5LmdldChldmVudE5hbWUpO1xyXG4gICAgaWYoIWVtaXRTZXQpe1xyXG4gICAgICAgIGVtaXRTZXQgPSBzZXRQb29sLmdldCgpO1xyXG4gICAgICAgIGVtaXRLZXkuc2V0KGV2ZW50TmFtZSwgZW1pdFNldCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYoZW1pdFNldC5oYXMoZW50aSkpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZighdHJhY2tlZFBhdGhzLnRyYWNrZWRPYmplY3RzLmhhcyhlbnRpLl9tb2RlbCkpe1xyXG4gICAgICAgIHRyYWNrZWRQYXRocy5lbnRpcy5kZWxldGUoZW50aSk7XHJcbiAgICAgICAgaWYodHJhY2tlZFBhdGhzLmVudGlzLnNpemUgPT09IDApe1xyXG4gICAgICAgICAgICBkZWxldGUgdHJhY2tlZE9iamVjdFBhdGhzW2V2ZW50TmFtZV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBlbWl0U2V0LmFkZChlbnRpKTtcclxuXHJcbiAgICB2YXIgdGFyZ2V0S2V5ID0gZ2V0VGFyZ2V0S2V5KGV2ZW50TmFtZSksXHJcbiAgICAgICAgdmFsdWUgPSBpc1dpbGRjYXJkUGF0aCh0YXJnZXRLZXkpID8gdW5kZWZpbmVkIDogZW50aS5nZXQodGFyZ2V0S2V5KTtcclxuXHJcbiAgICBlbnRpLmVtaXQoZXZlbnROYW1lLCB2YWx1ZSwgZXZlbnQpO1xyXG59XHJcblxyXG52YXIgdHJhY2tlZEV2ZW50cyA9IG5ldyBXZWFrTWFwKCk7XHJcbmZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoZW50aSwgdHJhY2tlZE9iamVjdFBhdGhzLCB0cmFja2VkUGF0aHMsIGV2ZW50TmFtZSl7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24oZXZlbnQsIGVtaXRLZXkpe1xyXG4gICAgICAgIHRyYWNrZWRQYXRocy5lbnRpcy5mb3JFYWNoKGVtaXRGb3JFbnRpLmJpbmQobnVsbCwgdHJhY2tlZFBhdGhzLCB0cmFja2VkT2JqZWN0UGF0aHMsIGV2ZW50TmFtZSwgZW1pdEtleSwgZXZlbnQpKTtcclxuICAgIH07XHJcbn1cclxuXHJcbnZhciBpbnRlcm5hbEV2ZW50cyA9IFsnbmV3TGlzdGVuZXInLCAnYXR0YWNoJywgJ2RldGFjaGVkJywgJ2Rlc3Ryb3knXTtcclxuZnVuY3Rpb24gaXNJbnRlcm5hbEV2ZW50KGVudGksIGV2ZW50TmFtZSl7XHJcbiAgICByZXR1cm4gfmludGVybmFsRXZlbnRzLmluZGV4T2YoZXZlbnROYW1lKSAmJlxyXG4gICAgICAgIGVudGkuX2V2ZW50cyAmJlxyXG4gICAgICAgIGVudGkuX2V2ZW50c1tldmVudE5hbWVdICYmXHJcbiAgICAgICAgKCFBcnJheS5pc0FycmF5KGVudGkuX2V2ZW50c1tldmVudE5hbWVdKSB8fCBlbnRpLl9ldmVudHNbZXZlbnROYW1lXS5sZW5ndGggPT09IDEpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0cmFja1BhdGgoZW50aSwgZXZlbnROYW1lKXtcclxuICAgIGlmKGlzSW50ZXJuYWxFdmVudChlbnRpLCBldmVudE5hbWUpKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIG9iamVjdCA9IGVudGkuX21vZGVsLFxyXG4gICAgICAgIHRyYWNrZWRPYmplY3RQYXRocyA9IHRyYWNrZWRFdmVudHMuZ2V0KG9iamVjdCk7XHJcblxyXG4gICAgaWYoIXRyYWNrZWRPYmplY3RQYXRocyl7XHJcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzID0ge307XHJcbiAgICAgICAgdHJhY2tlZEV2ZW50cy5zZXQob2JqZWN0LCB0cmFja2VkT2JqZWN0UGF0aHMpO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciB0cmFja2VkUGF0aHMgPSB0cmFja2VkT2JqZWN0UGF0aHNbZXZlbnROYW1lXTtcclxuXHJcbiAgICBpZighdHJhY2tlZFBhdGhzKXtcclxuICAgICAgICB0cmFja2VkUGF0aHMgPSB7XHJcbiAgICAgICAgICAgIGVudGlzOiBzZXRQb29sLmdldCgpLFxyXG4gICAgICAgICAgICB0cmFja2VkT2JqZWN0czogbmV3IFdlYWtTZXQoKVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgdHJhY2tlZE9iamVjdFBhdGhzW2V2ZW50TmFtZV0gPSB0cmFja2VkUGF0aHM7XHJcbiAgICB9ZWxzZSBpZih0cmFja2VkUGF0aHMuZW50aXMuaGFzKGVudGkpKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdHJhY2tlZFBhdGhzLmVudGlzLmFkZChlbnRpKTtcclxuXHJcbiAgICB2YXIgaGFuZGxlciA9IGNyZWF0ZUhhbmRsZXIoZW50aSwgdHJhY2tlZE9iamVjdFBhdGhzLCB0cmFja2VkUGF0aHMsIGV2ZW50TmFtZSk7XHJcblxyXG4gICAgdHJhY2tPYmplY3RzKGV2ZW50TmFtZSwgdHJhY2tlZFBhdGhzLnRyYWNrZWRPYmplY3RzLCBoYW5kbGVyLCB7bW9kZWw6b2JqZWN0fSwgJ21vZGVsJywgZXZlbnROYW1lKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdHJhY2tQYXRocyhlbnRpKXtcclxuICAgIGlmKCFlbnRpLl9ldmVudHMgfHwgIWVudGkuX21vZGVsKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgZm9yKHZhciBrZXkgaW4gZW50aS5fZXZlbnRzKXtcclxuICAgICAgICB0cmFja1BhdGgoZW50aSwga2V5KTtcclxuICAgIH1cclxuICAgIG1vZGlmaWVkRW50aWVzLmRlbGV0ZShlbnRpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZW1pdEV2ZW50KG9iamVjdCwga2V5LCB2YWx1ZSwgZW1pdEtleSl7XHJcblxyXG4gICAgbW9kaWZpZWRFbnRpZXMuZm9yRWFjaCh0cmFja1BhdGhzKTtcclxuXHJcbiAgICB2YXIgdHJhY2tlZEtleXMgPSB0cmFja2VkT2JqZWN0cy5nZXQob2JqZWN0KTtcclxuXHJcbiAgICBpZighdHJhY2tlZEtleXMpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgZXZlbnQgPSB7XHJcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxyXG4gICAgICAgIGtleToga2V5LFxyXG4gICAgICAgIG9iamVjdDogb2JqZWN0XHJcbiAgICB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIGVtaXRGb3JLZXkoaGFuZGxlcil7XHJcbiAgICAgICAgaGFuZGxlcihldmVudCwgZW1pdEtleSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYodHJhY2tlZEtleXNba2V5XSl7XHJcbiAgICAgICAgdHJhY2tlZEtleXNba2V5XS5mb3JFYWNoKGVtaXRGb3JLZXkpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKHRyYWNrZWRLZXlzWycqJ10pe1xyXG4gICAgICAgIHRyYWNrZWRLZXlzWycqJ10uZm9yRWFjaChlbWl0Rm9yS2V5KTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZW1pdChldmVudHMpe1xyXG4gICAgdmFyIGVtaXRLZXkgPSBlbWl0S2V5UG9vbC5nZXQoKTtcclxuXHJcbiAgICBldmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudCl7XHJcbiAgICAgICAgZW1pdEV2ZW50KGV2ZW50WzBdLCBldmVudFsxXSwgZXZlbnRbMl0sIGVtaXRLZXkpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgZW1pdEtleVBvb2wuZGlzcG9zZShlbWl0S2V5KTtcclxufVxyXG5cclxuZnVuY3Rpb24gb25OZXdMaXN0ZW5lcigpe1xyXG4gICAgbW9kaWZpZWRFbnRpZXMuYWRkKHRoaXMpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtb2RlbFJlbW92ZShtb2RlbCwgZXZlbnRzLCBrZXkpe1xyXG4gICAgaWYoQXJyYXkuaXNBcnJheShtb2RlbCkpe1xyXG4gICAgICAgIG1vZGVsLnNwbGljZShrZXksIDEpO1xyXG4gICAgICAgIGV2ZW50cy5wdXNoKFttb2RlbCwgJ2xlbmd0aCcsIG1vZGVsLmxlbmd0aF0pO1xyXG4gICAgfWVsc2V7XHJcbiAgICAgICAgZGVsZXRlIG1vZGVsW2tleV07XHJcbiAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCBrZXldKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gRW50aShtb2RlbCl7XHJcbiAgICB2YXIgZGV0YWNoZWQgPSBtb2RlbCA9PT0gZmFsc2U7XHJcblxyXG4gICAgaWYoIW1vZGVsIHx8ICh0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2RlbCAhPT0gJ2Z1bmN0aW9uJykpe1xyXG4gICAgICAgIG1vZGVsID0ge307XHJcbiAgICB9XHJcblxyXG4gICAgaWYoZGV0YWNoZWQpe1xyXG4gICAgICAgIHRoaXMuX21vZGVsID0ge307XHJcbiAgICB9ZWxzZXtcclxuICAgICAgICB0aGlzLmF0dGFjaChtb2RlbCk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5vbignbmV3TGlzdGVuZXInLCBvbk5ld0xpc3RlbmVyKTtcclxufVxyXG5FbnRpLmVtaXQgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XHJcbiAgICBpZighKHR5cGVvZiBtb2RlbCA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIG1vZGVsID09PSAnZnVuY3Rpb24nKSl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGVtaXQoW1ttb2RlbCwga2V5LCB2YWx1ZV1dKTtcclxufTtcclxuRW50aS5nZXQgPSBmdW5jdGlvbihtb2RlbCwga2V5KXtcclxuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAga2V5ID0gZ2V0VGFyZ2V0S2V5KGtleSk7XHJcblxyXG4gICAgaWYoa2V5ID09PSAnLicpe1xyXG4gICAgICAgIHJldHVybiBtb2RlbDtcclxuICAgIH1cclxuXHJcblxyXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xyXG4gICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XHJcbiAgICAgICAgcmV0dXJuIEVudGkuZ2V0KG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbW9kZWxba2V5XTtcclxufTtcclxuRW50aS5zZXQgPSBmdW5jdGlvbihtb2RlbCwga2V5LCB2YWx1ZSl7XHJcbiAgICBpZighbW9kZWwgfHwgdHlwZW9mIG1vZGVsICE9PSAnb2JqZWN0Jyl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGtleSA9IGdldFRhcmdldEtleShrZXkpO1xyXG5cclxuICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcclxuICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xyXG4gICAgICAgIHJldHVybiBFbnRpLnNldChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUpO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBvcmlnaW5hbCA9IG1vZGVsW2tleV07XHJcblxyXG4gICAgaWYodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyAmJiB2YWx1ZSA9PT0gb3JpZ2luYWwpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIga2V5c0NoYW5nZWQgPSAhKGtleSBpbiBtb2RlbCk7XHJcblxyXG4gICAgbW9kZWxba2V5XSA9IHZhbHVlO1xyXG5cclxuICAgIHZhciBldmVudHMgPSBbW21vZGVsLCBrZXksIHZhbHVlXV07XHJcblxyXG4gICAgaWYoa2V5c0NoYW5nZWQpe1xyXG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkobW9kZWwpKXtcclxuICAgICAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCAnbGVuZ3RoJywgbW9kZWwubGVuZ3RoXSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGVtaXQoZXZlbnRzKTtcclxufTtcclxuRW50aS5wdXNoID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUpe1xyXG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgdGFyZ2V0O1xyXG4gICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xyXG4gICAgICAgIHZhbHVlID0ga2V5O1xyXG4gICAgICAgIGtleSA9ICcuJztcclxuICAgICAgICB0YXJnZXQgPSBtb2RlbDtcclxuICAgIH1lbHNle1xyXG4gICAgICAgIHZhciBwYXRoID0gbGVmdEFuZFJlc3Qoa2V5KTtcclxuICAgICAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcclxuICAgICAgICAgICAgcmV0dXJuIEVudGkucHVzaChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGFyZ2V0ID0gbW9kZWxba2V5XTtcclxuICAgIH1cclxuXHJcbiAgICBpZighQXJyYXkuaXNBcnJheSh0YXJnZXQpKXtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB0YXJnZXQgaXMgbm90IGFuIGFycmF5LicpO1xyXG4gICAgfVxyXG5cclxuICAgIHRhcmdldC5wdXNoKHZhbHVlKTtcclxuXHJcbiAgICB2YXIgZXZlbnRzID0gW1xyXG4gICAgICAgIFt0YXJnZXQsIHRhcmdldC5sZW5ndGgtMSwgdmFsdWVdLFxyXG4gICAgICAgIFt0YXJnZXQsICdsZW5ndGgnLCB0YXJnZXQubGVuZ3RoXVxyXG4gICAgXTtcclxuXHJcbiAgICBlbWl0KGV2ZW50cyk7XHJcbn07XHJcbkVudGkuaW5zZXJ0ID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUsIGluZGV4KXtcclxuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG5cclxuICAgIHZhciB0YXJnZXQ7XHJcbiAgICBpZihhcmd1bWVudHMubGVuZ3RoIDwgNCl7XHJcbiAgICAgICAgaW5kZXggPSB2YWx1ZTtcclxuICAgICAgICB2YWx1ZSA9IGtleTtcclxuICAgICAgICBrZXkgPSAnLic7XHJcbiAgICAgICAgdGFyZ2V0ID0gbW9kZWw7XHJcbiAgICB9ZWxzZXtcclxuICAgICAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XHJcbiAgICAgICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XHJcbiAgICAgICAgICAgIHJldHVybiBFbnRpLmluc2VydChtb2RlbFtwYXRoWzBdXSwgcGF0aFsxXSwgdmFsdWUsIGluZGV4KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRhcmdldCA9IG1vZGVsW2tleV07XHJcbiAgICB9XHJcblxyXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGUgdGFyZ2V0IGlzIG5vdCBhbiBhcnJheS4nKTtcclxuICAgIH1cclxuXHJcbiAgICB0YXJnZXQuc3BsaWNlKGluZGV4LCAwLCB2YWx1ZSk7XHJcblxyXG4gICAgdmFyIGV2ZW50cyA9IFtcclxuICAgICAgICBbdGFyZ2V0LCBpbmRleCwgdmFsdWVdLFxyXG4gICAgICAgIFt0YXJnZXQsICdsZW5ndGgnLCB0YXJnZXQubGVuZ3RoXVxyXG4gICAgXTtcclxuXHJcbiAgICBlbWl0KGV2ZW50cyk7XHJcbn07XHJcbkVudGkucmVtb3ZlID0gZnVuY3Rpb24obW9kZWwsIGtleSwgc3ViS2V5KXtcclxuICAgIGlmKCFtb2RlbCB8fCB0eXBlb2YgbW9kZWwgIT09ICdvYmplY3QnKXtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xyXG4gICAgaWYoQXJyYXkuaXNBcnJheShwYXRoKSl7XHJcbiAgICAgICAgcmV0dXJuIEVudGkucmVtb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBzdWJLZXkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbW92ZSBhIGtleSBvZmYgb2YgYW4gb2JqZWN0IGF0ICdrZXknXHJcbiAgICBpZihzdWJLZXkgIT0gbnVsbCl7XHJcbiAgICAgICAgRW50aS5yZW1vdmUobW9kZWxba2V5XSwgc3ViS2V5KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYoa2V5ID09PSAnLicpe1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignLiAoc2VsZikgaXMgbm90IGEgdmFsaWQga2V5IHRvIHJlbW92ZScpO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBldmVudHMgPSBbXTtcclxuXHJcbiAgICBtb2RlbFJlbW92ZShtb2RlbCwgZXZlbnRzLCBrZXkpO1xyXG5cclxuICAgIGVtaXQoZXZlbnRzKTtcclxufTtcclxuRW50aS5tb3ZlID0gZnVuY3Rpb24obW9kZWwsIGtleSwgaW5kZXgpe1xyXG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgcGF0aCA9IGxlZnRBbmRSZXN0KGtleSk7XHJcbiAgICBpZihBcnJheS5pc0FycmF5KHBhdGgpKXtcclxuICAgICAgICByZXR1cm4gRW50aS5tb3ZlKG1vZGVsW3BhdGhbMF1dLCBwYXRoWzFdLCBpbmRleCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYoa2V5ID09PSBpbmRleCl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKCFBcnJheS5pc0FycmF5KG1vZGVsKSl7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGUgbW9kZWwgaXMgbm90IGFuIGFycmF5LicpO1xyXG4gICAgfVxyXG5cclxuICAgIHZhciBpdGVtID0gbW9kZWxba2V5XTtcclxuXHJcbiAgICBtb2RlbC5zcGxpY2Uoa2V5LCAxKTtcclxuXHJcbiAgICBtb2RlbC5zcGxpY2UoaW5kZXggLSAoaW5kZXggPiBrZXkgPyAwIDogMSksIDAsIGl0ZW0pO1xyXG5cclxuICAgIGVtaXQoW1ttb2RlbCwgaW5kZXgsIGl0ZW1dXSk7XHJcbn07XHJcbkVudGkudXBkYXRlID0gZnVuY3Rpb24obW9kZWwsIGtleSwgdmFsdWUsIG9wdGlvbnMpe1xyXG4gICAgaWYoIW1vZGVsIHx8IHR5cGVvZiBtb2RlbCAhPT0gJ29iamVjdCcpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgdGFyZ2V0LFxyXG4gICAgICAgIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5KHZhbHVlKTtcclxuXHJcbiAgICB2YXIgZXZlbnRzID0gW10sXHJcbiAgICAgICAgdXBkYXRlZE9iamVjdHMgPSBuZXcgV2Vha1NldCgpO1xyXG5cclxuICAgIGlmKHR5cGVvZiBrZXkgPT09ICdvYmplY3QnKXtcclxuICAgICAgICBvcHRpb25zID0gdmFsdWU7XHJcbiAgICAgICAgdmFsdWUgPSBrZXk7XHJcbiAgICAgICAga2V5ID0gJy4nO1xyXG4gICAgICAgIHRhcmdldCA9IG1vZGVsO1xyXG4gICAgfWVsc2V7XHJcbiAgICAgICAgdmFyIHBhdGggPSBsZWZ0QW5kUmVzdChrZXkpO1xyXG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkocGF0aCkpe1xyXG4gICAgICAgICAgICByZXR1cm4gRW50aS51cGRhdGUobW9kZWxbcGF0aFswXV0sIHBhdGhbMV0sIHZhbHVlKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKCEoa2V5IGluIG1vZGVsKSl7XHJcbiAgICAgICAgICAgIG1vZGVsW2tleV0gPSBpc0FycmF5ID8gW10gOiB7fTtcclxuICAgICAgICAgICAgZXZlbnRzLnB1c2goW21vZGVsLCBrZXksIHRhcmdldF0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGFyZ2V0ID0gbW9kZWxba2V5XTtcclxuICAgIH1cclxuXHJcbiAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB2YWx1ZSBpcyBub3QgYW4gb2JqZWN0LicpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKHR5cGVvZiB0YXJnZXQgIT09ICdvYmplY3QnKXtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSB0YXJnZXQgaXMgbm90IGFuIG9iamVjdC4nKTtcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB1cGRhdGVUYXJnZXQodGFyZ2V0LCB2YWx1ZSl7XHJcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gdmFsdWUpe1xyXG4gICAgICAgICAgICB2YXIgY3VycmVudFZhbHVlID0gdGFyZ2V0W2tleV07XHJcbiAgICAgICAgICAgIGlmKGN1cnJlbnRWYWx1ZSBpbnN0YW5jZW9mIE9iamVjdCAmJiAhdXBkYXRlZE9iamVjdHMuaGFzKGN1cnJlbnRWYWx1ZSkgJiYgIShjdXJyZW50VmFsdWUgaW5zdGFuY2VvZiBEYXRlKSl7XHJcbiAgICAgICAgICAgICAgICB1cGRhdGVkT2JqZWN0cy5hZGQoY3VycmVudFZhbHVlKTtcclxuICAgICAgICAgICAgICAgIHVwZGF0ZVRhcmdldChjdXJyZW50VmFsdWUsIHZhbHVlW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGFyZ2V0W2tleV0gPSB2YWx1ZVtrZXldO1xyXG4gICAgICAgICAgICBldmVudHMucHVzaChbdGFyZ2V0LCBrZXksIHZhbHVlW2tleV1dKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKG9wdGlvbnMgJiYgb3B0aW9ucy5zdHJhdGVneSA9PT0gJ21vcnBoJyl7XHJcbiAgICAgICAgICAgIGZvcih2YXIga2V5IGluIHRhcmdldCl7XHJcbiAgICAgICAgICAgICAgICBpZighKGtleSBpbiB2YWx1ZSkpe1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsUmVtb3ZlKHRhcmdldCwgZXZlbnRzLCBrZXkpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZihBcnJheS5pc0FycmF5KHRhcmdldCkpe1xyXG4gICAgICAgICAgICBldmVudHMucHVzaChbdGFyZ2V0LCAnbGVuZ3RoJywgdGFyZ2V0Lmxlbmd0aF0pO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB1cGRhdGVUYXJnZXQodGFyZ2V0LCB2YWx1ZSk7XHJcblxyXG4gICAgZW1pdChldmVudHMpO1xyXG59O1xyXG5FbnRpLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXZlbnRFbWl0dGVyLnByb3RvdHlwZSk7XHJcbkVudGkucHJvdG90eXBlLl9tYXhMaXN0ZW5lcnMgPSAxMDAwO1xyXG5FbnRpLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEVudGk7XHJcbkVudGkucHJvdG90eXBlLmF0dGFjaCA9IGZ1bmN0aW9uKG1vZGVsKXtcclxuICAgIGlmKHRoaXMuX21vZGVsID09PSBtb2RlbCl7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuZGV0YWNoKCk7XHJcblxyXG4gICAgaWYobW9kZWwgJiYgIWlzSW5zdGFuY2UobW9kZWwpKXtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VudGlzIG1heSBvbmx5IGJlIGF0dGFjaGVkIHRvIGFuIG9iamVjdCwgb3IgbnVsbC91bmRlZmluZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBtb2RpZmllZEVudGllcy5hZGQodGhpcyk7XHJcbiAgICB0aGlzLl9hdHRhY2hlZCA9IHRydWU7XHJcbiAgICB0aGlzLl9tb2RlbCA9IG1vZGVsO1xyXG4gICAgdGhpcy5lbWl0KCdhdHRhY2gnLCBtb2RlbCk7XHJcbn07XHJcbkVudGkucHJvdG90eXBlLmRldGFjaCA9IGZ1bmN0aW9uKCl7XHJcbiAgICBpZighdGhpcy5fYXR0YWNoZWQpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIG1vZGlmaWVkRW50aWVzLmRlbGV0ZSh0aGlzKTtcclxuXHJcbiAgICB0aGlzLl9tb2RlbCA9IHt9O1xyXG4gICAgdGhpcy5fYXR0YWNoZWQgPSBmYWxzZTtcclxuICAgIHRoaXMuZW1pdCgnZGV0YWNoJyk7XHJcbn07XHJcbkVudGkucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpe1xyXG4gICAgdGhpcy5kZXRhY2goKTtcclxuICAgIHRoaXMuZW1pdCgnZGVzdHJveScpO1xyXG4gICAgdGhpcy5fZXZlbnRzID0gdW5kZWZpbmVkO1xyXG59O1xyXG5FbnRpLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihrZXkpe1xyXG4gICAgcmV0dXJuIEVudGkuZ2V0KHRoaXMuX21vZGVsLCBrZXkpO1xyXG59O1xyXG5cclxuRW50aS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSl7XHJcbiAgICByZXR1cm4gRW50aS5zZXQodGhpcy5fbW9kZWwsIGtleSwgdmFsdWUpO1xyXG59O1xyXG5cclxuRW50aS5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUpe1xyXG4gICAgcmV0dXJuIEVudGkucHVzaC5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcclxufTtcclxuXHJcbkVudGkucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUsIGluZGV4KXtcclxuICAgIHJldHVybiBFbnRpLmluc2VydC5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcclxufTtcclxuXHJcbkVudGkucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGtleSwgc3ViS2V5KXtcclxuICAgIHJldHVybiBFbnRpLnJlbW92ZS5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcclxufTtcclxuXHJcbkVudGkucHJvdG90eXBlLm1vdmUgPSBmdW5jdGlvbihrZXksIGluZGV4KXtcclxuICAgIHJldHVybiBFbnRpLm1vdmUuYXBwbHkobnVsbCwgW3RoaXMuX21vZGVsXS5jb25jYXQodG9BcnJheShhcmd1bWVudHMpKSk7XHJcbn07XHJcblxyXG5FbnRpLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihrZXksIGluZGV4KXtcclxuICAgIHJldHVybiBFbnRpLnVwZGF0ZS5hcHBseShudWxsLCBbdGhpcy5fbW9kZWxdLmNvbmNhdCh0b0FycmF5KGFyZ3VtZW50cykpKTtcclxufTtcclxuRW50aS5wcm90b3R5cGUuaXNBdHRhY2hlZCA9IGZ1bmN0aW9uKCl7XHJcbiAgICByZXR1cm4gdGhpcy5fYXR0YWNoZWQ7XHJcbn07XHJcbkVudGkucHJvdG90eXBlLmF0dGFjaGVkQ291bnQgPSBmdW5jdGlvbigpe1xyXG4gICAgcmV0dXJuIG1vZGlmaWVkRW50aWVzLnNpemU7XHJcbn07XHJcblxyXG5FbnRpLmlzRW50aSA9IGZ1bmN0aW9uKHRhcmdldCl7XHJcbiAgICByZXR1cm4gdGFyZ2V0ICYmICEhfmdsb2JhbFN0YXRlLmluc3RhbmNlcy5pbmRleE9mKHRhcmdldC5jb25zdHJ1Y3Rvcik7XHJcbn07XHJcblxyXG5FbnRpLnN0b3JlID0gZnVuY3Rpb24odGFyZ2V0LCBrZXksIHZhbHVlKXtcclxuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPCAyKXtcclxuICAgICAgICByZXR1cm4gRW50aS5nZXQodGFyZ2V0LCBrZXkpO1xyXG4gICAgfVxyXG5cclxuICAgIEVudGkuc2V0KHRhcmdldCwga2V5LCB2YWx1ZSk7XHJcbn07XHJcblxyXG5nbG9iYWxTdGF0ZS5pbnN0YW5jZXMucHVzaChFbnRpKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRW50aTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih2YWx1ZSl7XHJcbiAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbic7XHJcbn07IiwidmFyIGV4cGxvcmVyID0gcmVxdWlyZSgnLi4vJykoe1xyXG4gICAgcmVzdWx0VHJhbnNmb3JtOiAocmVzdWx0LCB0b2tlbikgPT4ge1xyXG4gICAgICAgIHJldHVybiB0eXBlb2YgcmVzdWx0ID09PSAnbnVtYmVyJyA/IHJlc3VsdC50b0ZpeGVkKDIpIDogcmVzdWx0XHJcbiAgICB9LFxyXG4gICAgbm9kZUFjdGlvbjogKGV2ZW50LCBjb21wb25lbnQsIHNjb3BlLCB0b2tlbikgPT4ge1xyXG4gICAgICAgIGlmKHRva2VuLnR5cGUgPT09ICdudW1iZXInKXtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgdmFyIGFjdGl2ZSA9IGNvbXBvbmVudC5lbGVtZW50LmNsYXNzTGlzdC5jb250YWlucygnYWN0aXZlJylcclxuICAgICAgICBpZihhY3RpdmUpe1xyXG4gICAgICAgICAgICBjb21wb25lbnQuZWxlbWVudC5jbGFzc0xpc3QucmVtb3ZlKCdhY3RpdmUnKVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbXBvbmVudC5lbGVtZW50LmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpXHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59KVxyXG5cclxuZXhwbG9yZXIuc291cmNlKGBcclxubWF0aC5taW4oXHJcbiAgICAoXHJcbiAgICAgICAgMSAvIDEyICpcclxuICAgICAgICBiYXIgKyBhZGQoMiA0IC8gZm9vKVxyXG4gICAgKSAvIGZvb1xyXG4gICAgdHJ1ZSA/IDIgOiAzXHJcbilcclxuYClcclxudmFyIGRlZmF1bHRHbG9iYWxzID0ge1xyXG4gICAgYWRkOiAoYSwgYikgPT4gYSArIGIsXHJcbiAgICBmb286IDRcclxufTtcclxuZXhwbG9yZXIuZ2xvYmFscyhkZWZhdWx0R2xvYmFscylcclxuXHJcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgZnVuY3Rpb24oKXtcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZXhwbG9yZXIuZWxlbWVudClcclxufSlcclxuXHJcbnNldEludGVydmFsKGZ1bmN0aW9uKCl7XHJcbiAgICBleHBsb3Jlci5nbG9iYWxzKHtcclxuICAgICAgICAuLi5kZWZhdWx0R2xvYmFscyxcclxuICAgICAgICBmb286IE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDEwKSxcclxuICAgICAgICBiYXI6IE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDEwKVxyXG4gICAgfSlcclxufSwgMTAwKTsiLCJ2YXIgZmFzdG4gPSByZXF1aXJlKCdmYXN0bicpKHJlcXVpcmUoJ2Zhc3RuL2RvbUNvbXBvbmVudHMnKSh7XHJcbiAgICBwcmVzaEV4cGxvcmVyOiByZXF1aXJlKCcuL3ByZXNoRXhwbG9yZXJDb21wb25lbnQnKVxyXG59KSk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHNldHRpbmdzKXtcclxuICAgIGlmKCFzZXR0aW5ncyB8fCAhKHNldHRpbmdzIGluc3RhbmNlb2YgT2JqZWN0KSl7XHJcbiAgICAgICAgc2V0dGluZ3MgPSB7fVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBmYXN0bigncHJlc2hFeHBsb3JlcicsIHNldHRpbmdzKVxyXG4gICAgICAgIC5hdHRhY2goKVxyXG4gICAgICAgIC5yZW5kZXIoKVxyXG59OyIsIid1c2Ugc3RyaWN0J1xuXG5leHBvcnRzLmJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoXG5leHBvcnRzLnRvQnl0ZUFycmF5ID0gdG9CeXRlQXJyYXlcbmV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IGZyb21CeXRlQXJyYXlcblxudmFyIGxvb2t1cCA9IFtdXG52YXIgcmV2TG9va3VwID0gW11cbnZhciBBcnIgPSB0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcgPyBVaW50OEFycmF5IDogQXJyYXlcblxudmFyIGNvZGUgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLydcbmZvciAodmFyIGkgPSAwLCBsZW4gPSBjb2RlLmxlbmd0aDsgaSA8IGxlbjsgKytpKSB7XG4gIGxvb2t1cFtpXSA9IGNvZGVbaV1cbiAgcmV2TG9va3VwW2NvZGUuY2hhckNvZGVBdChpKV0gPSBpXG59XG5cbi8vIFN1cHBvcnQgZGVjb2RpbmcgVVJMLXNhZmUgYmFzZTY0IHN0cmluZ3MsIGFzIE5vZGUuanMgZG9lcy5cbi8vIFNlZTogaHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvQmFzZTY0I1VSTF9hcHBsaWNhdGlvbnNcbnJldkxvb2t1cFsnLScuY2hhckNvZGVBdCgwKV0gPSA2MlxucmV2TG9va3VwWydfJy5jaGFyQ29kZUF0KDApXSA9IDYzXG5cbmZ1bmN0aW9uIGdldExlbnMgKGI2NCkge1xuICB2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXG4gIGlmIChsZW4gJSA0ID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNCcpXG4gIH1cblxuICAvLyBUcmltIG9mZiBleHRyYSBieXRlcyBhZnRlciBwbGFjZWhvbGRlciBieXRlcyBhcmUgZm91bmRcbiAgLy8gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vYmVhdGdhbW1pdC9iYXNlNjQtanMvaXNzdWVzLzQyXG4gIHZhciB2YWxpZExlbiA9IGI2NC5pbmRleE9mKCc9JylcbiAgaWYgKHZhbGlkTGVuID09PSAtMSkgdmFsaWRMZW4gPSBsZW5cblxuICB2YXIgcGxhY2VIb2xkZXJzTGVuID0gdmFsaWRMZW4gPT09IGxlblxuICAgID8gMFxuICAgIDogNCAtICh2YWxpZExlbiAlIDQpXG5cbiAgcmV0dXJuIFt2YWxpZExlbiwgcGxhY2VIb2xkZXJzTGVuXVxufVxuXG4vLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcbmZ1bmN0aW9uIGJ5dGVMZW5ndGggKGI2NCkge1xuICB2YXIgbGVucyA9IGdldExlbnMoYjY0KVxuICB2YXIgdmFsaWRMZW4gPSBsZW5zWzBdXG4gIHZhciBwbGFjZUhvbGRlcnNMZW4gPSBsZW5zWzFdXG4gIHJldHVybiAoKHZhbGlkTGVuICsgcGxhY2VIb2xkZXJzTGVuKSAqIDMgLyA0KSAtIHBsYWNlSG9sZGVyc0xlblxufVxuXG5mdW5jdGlvbiBfYnl0ZUxlbmd0aCAoYjY0LCB2YWxpZExlbiwgcGxhY2VIb2xkZXJzTGVuKSB7XG4gIHJldHVybiAoKHZhbGlkTGVuICsgcGxhY2VIb2xkZXJzTGVuKSAqIDMgLyA0KSAtIHBsYWNlSG9sZGVyc0xlblxufVxuXG5mdW5jdGlvbiB0b0J5dGVBcnJheSAoYjY0KSB7XG4gIHZhciB0bXBcbiAgdmFyIGxlbnMgPSBnZXRMZW5zKGI2NClcbiAgdmFyIHZhbGlkTGVuID0gbGVuc1swXVxuICB2YXIgcGxhY2VIb2xkZXJzTGVuID0gbGVuc1sxXVxuXG4gIHZhciBhcnIgPSBuZXcgQXJyKF9ieXRlTGVuZ3RoKGI2NCwgdmFsaWRMZW4sIHBsYWNlSG9sZGVyc0xlbikpXG5cbiAgdmFyIGN1ckJ5dGUgPSAwXG5cbiAgLy8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuICB2YXIgbGVuID0gcGxhY2VIb2xkZXJzTGVuID4gMFxuICAgID8gdmFsaWRMZW4gLSA0XG4gICAgOiB2YWxpZExlblxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpICs9IDQpIHtcbiAgICB0bXAgPVxuICAgICAgKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpKV0gPDwgMTgpIHxcbiAgICAgIChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSArIDEpXSA8PCAxMikgfFxuICAgICAgKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMildIDw8IDYpIHxcbiAgICAgIHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMyldXG4gICAgYXJyW2N1ckJ5dGUrK10gPSAodG1wID4+IDE2KSAmIDB4RkZcbiAgICBhcnJbY3VyQnl0ZSsrXSA9ICh0bXAgPj4gOCkgJiAweEZGXG4gICAgYXJyW2N1ckJ5dGUrK10gPSB0bXAgJiAweEZGXG4gIH1cblxuICBpZiAocGxhY2VIb2xkZXJzTGVuID09PSAyKSB7XG4gICAgdG1wID1cbiAgICAgIChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSldIDw8IDIpIHxcbiAgICAgIChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSArIDEpXSA+PiA0KVxuICAgIGFycltjdXJCeXRlKytdID0gdG1wICYgMHhGRlxuICB9XG5cbiAgaWYgKHBsYWNlSG9sZGVyc0xlbiA9PT0gMSkge1xuICAgIHRtcCA9XG4gICAgICAocmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkpXSA8PCAxMCkgfFxuICAgICAgKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMSldIDw8IDQpIHxcbiAgICAgIChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSArIDIpXSA+PiAyKVxuICAgIGFycltjdXJCeXRlKytdID0gKHRtcCA+PiA4KSAmIDB4RkZcbiAgICBhcnJbY3VyQnl0ZSsrXSA9IHRtcCAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBhcnJcbn1cblxuZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcbiAgcmV0dXJuIGxvb2t1cFtudW0gPj4gMTggJiAweDNGXSArXG4gICAgbG9va3VwW251bSA+PiAxMiAmIDB4M0ZdICtcbiAgICBsb29rdXBbbnVtID4+IDYgJiAweDNGXSArXG4gICAgbG9va3VwW251bSAmIDB4M0ZdXG59XG5cbmZ1bmN0aW9uIGVuY29kZUNodW5rICh1aW50OCwgc3RhcnQsIGVuZCkge1xuICB2YXIgdG1wXG4gIHZhciBvdXRwdXQgPSBbXVxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkgKz0gMykge1xuICAgIHRtcCA9XG4gICAgICAoKHVpbnQ4W2ldIDw8IDE2KSAmIDB4RkYwMDAwKSArXG4gICAgICAoKHVpbnQ4W2kgKyAxXSA8PCA4KSAmIDB4RkYwMCkgK1xuICAgICAgKHVpbnQ4W2kgKyAyXSAmIDB4RkYpXG4gICAgb3V0cHV0LnB1c2godHJpcGxldFRvQmFzZTY0KHRtcCkpXG4gIH1cbiAgcmV0dXJuIG91dHB1dC5qb2luKCcnKVxufVxuXG5mdW5jdGlvbiBmcm9tQnl0ZUFycmF5ICh1aW50OCkge1xuICB2YXIgdG1wXG4gIHZhciBsZW4gPSB1aW50OC5sZW5ndGhcbiAgdmFyIGV4dHJhQnl0ZXMgPSBsZW4gJSAzIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG4gIHZhciBwYXJ0cyA9IFtdXG4gIHZhciBtYXhDaHVua0xlbmd0aCA9IDE2MzgzIC8vIG11c3QgYmUgbXVsdGlwbGUgb2YgM1xuXG4gIC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcbiAgZm9yICh2YXIgaSA9IDAsIGxlbjIgPSBsZW4gLSBleHRyYUJ5dGVzOyBpIDwgbGVuMjsgaSArPSBtYXhDaHVua0xlbmd0aCkge1xuICAgIHBhcnRzLnB1c2goZW5jb2RlQ2h1bmsoXG4gICAgICB1aW50OCwgaSwgKGkgKyBtYXhDaHVua0xlbmd0aCkgPiBsZW4yID8gbGVuMiA6IChpICsgbWF4Q2h1bmtMZW5ndGgpXG4gICAgKSlcbiAgfVxuXG4gIC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcbiAgaWYgKGV4dHJhQnl0ZXMgPT09IDEpIHtcbiAgICB0bXAgPSB1aW50OFtsZW4gLSAxXVxuICAgIHBhcnRzLnB1c2goXG4gICAgICBsb29rdXBbdG1wID4+IDJdICtcbiAgICAgIGxvb2t1cFsodG1wIDw8IDQpICYgMHgzRl0gK1xuICAgICAgJz09J1xuICAgIClcbiAgfSBlbHNlIGlmIChleHRyYUJ5dGVzID09PSAyKSB7XG4gICAgdG1wID0gKHVpbnQ4W2xlbiAtIDJdIDw8IDgpICsgdWludDhbbGVuIC0gMV1cbiAgICBwYXJ0cy5wdXNoKFxuICAgICAgbG9va3VwW3RtcCA+PiAxMF0gK1xuICAgICAgbG9va3VwWyh0bXAgPj4gNCkgJiAweDNGXSArXG4gICAgICBsb29rdXBbKHRtcCA8PCAyKSAmIDB4M0ZdICtcbiAgICAgICc9J1xuICAgIClcbiAgfVxuXG4gIHJldHVybiBwYXJ0cy5qb2luKCcnKVxufVxuIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8aHR0cHM6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG4vKiBlc2xpbnQtZGlzYWJsZSBuby1wcm90byAqL1xuXG4ndXNlIHN0cmljdCdcblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5cbnZhciBLX01BWF9MRU5HVEggPSAweDdmZmZmZmZmXG5leHBvcnRzLmtNYXhMZW5ndGggPSBLX01BWF9MRU5HVEhcblxuLyoqXG4gKiBJZiBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgUHJpbnQgd2FybmluZyBhbmQgcmVjb21tZW5kIHVzaW5nIGBidWZmZXJgIHY0Lnggd2hpY2ggaGFzIGFuIE9iamVjdFxuICogICAgICAgICAgICAgICBpbXBsZW1lbnRhdGlvbiAobW9zdCBjb21wYXRpYmxlLCBldmVuIElFNilcbiAqXG4gKiBCcm93c2VycyB0aGF0IHN1cHBvcnQgdHlwZWQgYXJyYXlzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssIENocm9tZSA3KywgU2FmYXJpIDUuMSssXG4gKiBPcGVyYSAxMS42KywgaU9TIDQuMisuXG4gKlxuICogV2UgcmVwb3J0IHRoYXQgdGhlIGJyb3dzZXIgZG9lcyBub3Qgc3VwcG9ydCB0eXBlZCBhcnJheXMgaWYgdGhlIGFyZSBub3Qgc3ViY2xhc3NhYmxlXG4gKiB1c2luZyBfX3Byb3RvX18uIEZpcmVmb3ggNC0yOSBsYWNrcyBzdXBwb3J0IGZvciBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgXG4gKiAoU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzgpLiBJRSAxMCBsYWNrcyBzdXBwb3J0XG4gKiBmb3IgX19wcm90b19fIGFuZCBoYXMgYSBidWdneSB0eXBlZCBhcnJheSBpbXBsZW1lbnRhdGlvbi5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSB0eXBlZEFycmF5U3VwcG9ydCgpXG5cbmlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgdHlwZW9mIGNvbnNvbGUgIT09ICd1bmRlZmluZWQnICYmXG4gICAgdHlwZW9mIGNvbnNvbGUuZXJyb3IgPT09ICdmdW5jdGlvbicpIHtcbiAgY29uc29sZS5lcnJvcihcbiAgICAnVGhpcyBicm93c2VyIGxhY2tzIHR5cGVkIGFycmF5IChVaW50OEFycmF5KSBzdXBwb3J0IHdoaWNoIGlzIHJlcXVpcmVkIGJ5ICcgK1xuICAgICdgYnVmZmVyYCB2NS54LiBVc2UgYGJ1ZmZlcmAgdjQueCBpZiB5b3UgcmVxdWlyZSBvbGQgYnJvd3NlciBzdXBwb3J0LidcbiAgKVxufVxuXG5mdW5jdGlvbiB0eXBlZEFycmF5U3VwcG9ydCAoKSB7XG4gIC8vIENhbiB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZD9cbiAgdHJ5IHtcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoMSlcbiAgICBhcnIuX19wcm90b19fID0geyBfX3Byb3RvX186IFVpbnQ4QXJyYXkucHJvdG90eXBlLCBmb286IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH0gfVxuICAgIHJldHVybiBhcnIuZm9vKCkgPT09IDQyXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoQnVmZmVyLnByb3RvdHlwZSwgJ3BhcmVudCcsIHtcbiAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgZ2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKCFCdWZmZXIuaXNCdWZmZXIodGhpcykpIHJldHVybiB1bmRlZmluZWRcbiAgICByZXR1cm4gdGhpcy5idWZmZXJcbiAgfVxufSlcblxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEJ1ZmZlci5wcm90b3R5cGUsICdvZmZzZXQnLCB7XG4gIGVudW1lcmFibGU6IHRydWUsXG4gIGdldDogZnVuY3Rpb24gKCkge1xuICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKHRoaXMpKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgcmV0dXJuIHRoaXMuYnl0ZU9mZnNldFxuICB9XG59KVxuXG5mdW5jdGlvbiBjcmVhdGVCdWZmZXIgKGxlbmd0aCkge1xuICBpZiAobGVuZ3RoID4gS19NQVhfTEVOR1RIKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RoZSB2YWx1ZSBcIicgKyBsZW5ndGggKyAnXCIgaXMgaW52YWxpZCBmb3Igb3B0aW9uIFwic2l6ZVwiJylcbiAgfVxuICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZVxuICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkobGVuZ3RoKVxuICBidWYuX19wcm90b19fID0gQnVmZmVyLnByb3RvdHlwZVxuICByZXR1cm4gYnVmXG59XG5cbi8qKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBoYXZlIHRoZWlyXG4gKiBwcm90b3R5cGUgY2hhbmdlZCB0byBgQnVmZmVyLnByb3RvdHlwZWAuIEZ1cnRoZXJtb3JlLCBgQnVmZmVyYCBpcyBhIHN1YmNsYXNzIG9mXG4gKiBgVWludDhBcnJheWAsIHNvIHRoZSByZXR1cm5lZCBpbnN0YW5jZXMgd2lsbCBoYXZlIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBtZXRob2RzXG4gKiBhbmQgdGhlIGBVaW50OEFycmF5YCBtZXRob2RzLiBTcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdFxuICogcmV0dXJucyBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBUaGUgYFVpbnQ4QXJyYXlgIHByb3RvdHlwZSByZW1haW5zIHVubW9kaWZpZWQuXG4gKi9cblxuZnVuY3Rpb24gQnVmZmVyIChhcmcsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aCkge1xuICAvLyBDb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdudW1iZXInKSB7XG4gICAgaWYgKHR5cGVvZiBlbmNvZGluZ09yT2Zmc2V0ID09PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgJ1RoZSBcInN0cmluZ1wiIGFyZ3VtZW50IG11c3QgYmUgb2YgdHlwZSBzdHJpbmcuIFJlY2VpdmVkIHR5cGUgbnVtYmVyJ1xuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm4gYWxsb2NVbnNhZmUoYXJnKVxuICB9XG4gIHJldHVybiBmcm9tKGFyZywgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKVxufVxuXG4vLyBGaXggc3ViYXJyYXkoKSBpbiBFUzIwMTYuIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL2Zlcm9zcy9idWZmZXIvcHVsbC85N1xuaWYgKHR5cGVvZiBTeW1ib2wgIT09ICd1bmRlZmluZWQnICYmIFN5bWJvbC5zcGVjaWVzICE9IG51bGwgJiZcbiAgICBCdWZmZXJbU3ltYm9sLnNwZWNpZXNdID09PSBCdWZmZXIpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KEJ1ZmZlciwgU3ltYm9sLnNwZWNpZXMsIHtcbiAgICB2YWx1ZTogbnVsbCxcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgd3JpdGFibGU6IGZhbHNlXG4gIH0pXG59XG5cbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTIgLy8gbm90IHVzZWQgYnkgdGhpcyBpbXBsZW1lbnRhdGlvblxuXG5mdW5jdGlvbiBmcm9tICh2YWx1ZSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZyb21TdHJpbmcodmFsdWUsIGVuY29kaW5nT3JPZmZzZXQpXG4gIH1cblxuICBpZiAoQXJyYXlCdWZmZXIuaXNWaWV3KHZhbHVlKSkge1xuICAgIHJldHVybiBmcm9tQXJyYXlMaWtlKHZhbHVlKVxuICB9XG5cbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICB0aHJvdyBUeXBlRXJyb3IoXG4gICAgICAnVGhlIGZpcnN0IGFyZ3VtZW50IG11c3QgYmUgb25lIG9mIHR5cGUgc3RyaW5nLCBCdWZmZXIsIEFycmF5QnVmZmVyLCBBcnJheSwgJyArXG4gICAgICAnb3IgQXJyYXktbGlrZSBPYmplY3QuIFJlY2VpdmVkIHR5cGUgJyArICh0eXBlb2YgdmFsdWUpXG4gICAgKVxuICB9XG5cbiAgaWYgKGlzSW5zdGFuY2UodmFsdWUsIEFycmF5QnVmZmVyKSB8fFxuICAgICAgKHZhbHVlICYmIGlzSW5zdGFuY2UodmFsdWUuYnVmZmVyLCBBcnJheUJ1ZmZlcikpKSB7XG4gICAgcmV0dXJuIGZyb21BcnJheUJ1ZmZlcih2YWx1ZSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgJ1RoZSBcInZhbHVlXCIgYXJndW1lbnQgbXVzdCBub3QgYmUgb2YgdHlwZSBudW1iZXIuIFJlY2VpdmVkIHR5cGUgbnVtYmVyJ1xuICAgIClcbiAgfVxuXG4gIHZhciB2YWx1ZU9mID0gdmFsdWUudmFsdWVPZiAmJiB2YWx1ZS52YWx1ZU9mKClcbiAgaWYgKHZhbHVlT2YgIT0gbnVsbCAmJiB2YWx1ZU9mICE9PSB2YWx1ZSkge1xuICAgIHJldHVybiBCdWZmZXIuZnJvbSh2YWx1ZU9mLCBlbmNvZGluZ09yT2Zmc2V0LCBsZW5ndGgpXG4gIH1cblxuICB2YXIgYiA9IGZyb21PYmplY3QodmFsdWUpXG4gIGlmIChiKSByZXR1cm4gYlxuXG4gIGlmICh0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJyAmJiBTeW1ib2wudG9QcmltaXRpdmUgIT0gbnVsbCAmJlxuICAgICAgdHlwZW9mIHZhbHVlW1N5bWJvbC50b1ByaW1pdGl2ZV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oXG4gICAgICB2YWx1ZVtTeW1ib2wudG9QcmltaXRpdmVdKCdzdHJpbmcnKSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoXG4gICAgKVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAnVGhlIGZpcnN0IGFyZ3VtZW50IG11c3QgYmUgb25lIG9mIHR5cGUgc3RyaW5nLCBCdWZmZXIsIEFycmF5QnVmZmVyLCBBcnJheSwgJyArXG4gICAgJ29yIEFycmF5LWxpa2UgT2JqZWN0LiBSZWNlaXZlZCB0eXBlICcgKyAodHlwZW9mIHZhbHVlKVxuICApXG59XG5cbi8qKlxuICogRnVuY3Rpb25hbGx5IGVxdWl2YWxlbnQgdG8gQnVmZmVyKGFyZywgZW5jb2RpbmcpIGJ1dCB0aHJvd3MgYSBUeXBlRXJyb3JcbiAqIGlmIHZhbHVlIGlzIGEgbnVtYmVyLlxuICogQnVmZmVyLmZyb20oc3RyWywgZW5jb2RpbmddKVxuICogQnVmZmVyLmZyb20oYXJyYXkpXG4gKiBCdWZmZXIuZnJvbShidWZmZXIpXG4gKiBCdWZmZXIuZnJvbShhcnJheUJ1ZmZlclssIGJ5dGVPZmZzZXRbLCBsZW5ndGhdXSlcbiAqKi9cbkJ1ZmZlci5mcm9tID0gZnVuY3Rpb24gKHZhbHVlLCBlbmNvZGluZ09yT2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGZyb20odmFsdWUsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aClcbn1cblxuLy8gTm90ZTogQ2hhbmdlIHByb3RvdHlwZSAqYWZ0ZXIqIEJ1ZmZlci5mcm9tIGlzIGRlZmluZWQgdG8gd29ya2Fyb3VuZCBDaHJvbWUgYnVnOlxuLy8gaHR0cHM6Ly9naXRodWIuY29tL2Zlcm9zcy9idWZmZXIvcHVsbC8xNDhcbkJ1ZmZlci5wcm90b3R5cGUuX19wcm90b19fID0gVWludDhBcnJheS5wcm90b3R5cGVcbkJ1ZmZlci5fX3Byb3RvX18gPSBVaW50OEFycmF5XG5cbmZ1bmN0aW9uIGFzc2VydFNpemUgKHNpemUpIHtcbiAgaWYgKHR5cGVvZiBzaXplICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wic2l6ZVwiIGFyZ3VtZW50IG11c3QgYmUgb2YgdHlwZSBudW1iZXInKVxuICB9IGVsc2UgaWYgKHNpemUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RoZSB2YWx1ZSBcIicgKyBzaXplICsgJ1wiIGlzIGludmFsaWQgZm9yIG9wdGlvbiBcInNpemVcIicpXG4gIH1cbn1cblxuZnVuY3Rpb24gYWxsb2MgKHNpemUsIGZpbGwsIGVuY29kaW5nKSB7XG4gIGFzc2VydFNpemUoc2l6ZSlcbiAgaWYgKHNpemUgPD0gMCkge1xuICAgIHJldHVybiBjcmVhdGVCdWZmZXIoc2l6ZSlcbiAgfVxuICBpZiAoZmlsbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gT25seSBwYXkgYXR0ZW50aW9uIHRvIGVuY29kaW5nIGlmIGl0J3MgYSBzdHJpbmcuIFRoaXNcbiAgICAvLyBwcmV2ZW50cyBhY2NpZGVudGFsbHkgc2VuZGluZyBpbiBhIG51bWJlciB0aGF0IHdvdWxkXG4gICAgLy8gYmUgaW50ZXJwcmV0dGVkIGFzIGEgc3RhcnQgb2Zmc2V0LlxuICAgIHJldHVybiB0eXBlb2YgZW5jb2RpbmcgPT09ICdzdHJpbmcnXG4gICAgICA/IGNyZWF0ZUJ1ZmZlcihzaXplKS5maWxsKGZpbGwsIGVuY29kaW5nKVxuICAgICAgOiBjcmVhdGVCdWZmZXIoc2l6ZSkuZmlsbChmaWxsKVxuICB9XG4gIHJldHVybiBjcmVhdGVCdWZmZXIoc2l6ZSlcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGZpbGxlZCBCdWZmZXIgaW5zdGFuY2UuXG4gKiBhbGxvYyhzaXplWywgZmlsbFssIGVuY29kaW5nXV0pXG4gKiovXG5CdWZmZXIuYWxsb2MgPSBmdW5jdGlvbiAoc2l6ZSwgZmlsbCwgZW5jb2RpbmcpIHtcbiAgcmV0dXJuIGFsbG9jKHNpemUsIGZpbGwsIGVuY29kaW5nKVxufVxuXG5mdW5jdGlvbiBhbGxvY1Vuc2FmZSAoc2l6ZSkge1xuICBhc3NlcnRTaXplKHNpemUpXG4gIHJldHVybiBjcmVhdGVCdWZmZXIoc2l6ZSA8IDAgPyAwIDogY2hlY2tlZChzaXplKSB8IDApXG59XG5cbi8qKlxuICogRXF1aXZhbGVudCB0byBCdWZmZXIobnVtKSwgYnkgZGVmYXVsdCBjcmVhdGVzIGEgbm9uLXplcm8tZmlsbGVkIEJ1ZmZlciBpbnN0YW5jZS5cbiAqICovXG5CdWZmZXIuYWxsb2NVbnNhZmUgPSBmdW5jdGlvbiAoc2l6ZSkge1xuICByZXR1cm4gYWxsb2NVbnNhZmUoc2l6ZSlcbn1cbi8qKlxuICogRXF1aXZhbGVudCB0byBTbG93QnVmZmVyKG51bSksIGJ5IGRlZmF1bHQgY3JlYXRlcyBhIG5vbi16ZXJvLWZpbGxlZCBCdWZmZXIgaW5zdGFuY2UuXG4gKi9cbkJ1ZmZlci5hbGxvY1Vuc2FmZVNsb3cgPSBmdW5jdGlvbiAoc2l6ZSkge1xuICByZXR1cm4gYWxsb2NVbnNhZmUoc2l6ZSlcbn1cblxuZnVuY3Rpb24gZnJvbVN0cmluZyAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJyB8fCBlbmNvZGluZyA9PT0gJycpIHtcbiAgICBlbmNvZGluZyA9ICd1dGY4J1xuICB9XG5cbiAgaWYgKCFCdWZmZXIuaXNFbmNvZGluZyhlbmNvZGluZykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gIH1cblxuICB2YXIgbGVuZ3RoID0gYnl0ZUxlbmd0aChzdHJpbmcsIGVuY29kaW5nKSB8IDBcbiAgdmFyIGJ1ZiA9IGNyZWF0ZUJ1ZmZlcihsZW5ndGgpXG5cbiAgdmFyIGFjdHVhbCA9IGJ1Zi53cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuXG4gIGlmIChhY3R1YWwgIT09IGxlbmd0aCkge1xuICAgIC8vIFdyaXRpbmcgYSBoZXggc3RyaW5nLCBmb3IgZXhhbXBsZSwgdGhhdCBjb250YWlucyBpbnZhbGlkIGNoYXJhY3RlcnMgd2lsbFxuICAgIC8vIGNhdXNlIGV2ZXJ5dGhpbmcgYWZ0ZXIgdGhlIGZpcnN0IGludmFsaWQgY2hhcmFjdGVyIHRvIGJlIGlnbm9yZWQuIChlLmcuXG4gICAgLy8gJ2FieHhjZCcgd2lsbCBiZSB0cmVhdGVkIGFzICdhYicpXG4gICAgYnVmID0gYnVmLnNsaWNlKDAsIGFjdHVhbClcbiAgfVxuXG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5TGlrZSAoYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aCA8IDAgPyAwIDogY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB2YXIgYnVmID0gY3JlYXRlQnVmZmVyKGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIGJ1ZltpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlCdWZmZXIgKGFycmF5LCBieXRlT2Zmc2V0LCBsZW5ndGgpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwIHx8IGFycmF5LmJ5dGVMZW5ndGggPCBieXRlT2Zmc2V0KSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1wib2Zmc2V0XCIgaXMgb3V0c2lkZSBvZiBidWZmZXIgYm91bmRzJylcbiAgfVxuXG4gIGlmIChhcnJheS5ieXRlTGVuZ3RoIDwgYnl0ZU9mZnNldCArIChsZW5ndGggfHwgMCkpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignXCJsZW5ndGhcIiBpcyBvdXRzaWRlIG9mIGJ1ZmZlciBib3VuZHMnKVxuICB9XG5cbiAgdmFyIGJ1ZlxuICBpZiAoYnl0ZU9mZnNldCA9PT0gdW5kZWZpbmVkICYmIGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgYnVmID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXkpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICBidWYgPSBuZXcgVWludDhBcnJheShhcnJheSwgYnl0ZU9mZnNldClcbiAgfSBlbHNlIHtcbiAgICBidWYgPSBuZXcgVWludDhBcnJheShhcnJheSwgYnl0ZU9mZnNldCwgbGVuZ3RoKVxuICB9XG5cbiAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2VcbiAgYnVmLl9fcHJvdG9fXyA9IEJ1ZmZlci5wcm90b3R5cGVcbiAgcmV0dXJuIGJ1ZlxufVxuXG5mdW5jdGlvbiBmcm9tT2JqZWN0IChvYmopIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmopKSB7XG4gICAgdmFyIGxlbiA9IGNoZWNrZWQob2JqLmxlbmd0aCkgfCAwXG4gICAgdmFyIGJ1ZiA9IGNyZWF0ZUJ1ZmZlcihsZW4pXG5cbiAgICBpZiAoYnVmLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGJ1ZlxuICAgIH1cblxuICAgIG9iai5jb3B5KGJ1ZiwgMCwgMCwgbGVuKVxuICAgIHJldHVybiBidWZcbiAgfVxuXG4gIGlmIChvYmoubGVuZ3RoICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAodHlwZW9mIG9iai5sZW5ndGggIT09ICdudW1iZXInIHx8IG51bWJlcklzTmFOKG9iai5sZW5ndGgpKSB7XG4gICAgICByZXR1cm4gY3JlYXRlQnVmZmVyKDApXG4gICAgfVxuICAgIHJldHVybiBmcm9tQXJyYXlMaWtlKG9iailcbiAgfVxuXG4gIGlmIChvYmoudHlwZSA9PT0gJ0J1ZmZlcicgJiYgQXJyYXkuaXNBcnJheShvYmouZGF0YSkpIHtcbiAgICByZXR1cm4gZnJvbUFycmF5TGlrZShvYmouZGF0YSlcbiAgfVxufVxuXG5mdW5jdGlvbiBjaGVja2VkIChsZW5ndGgpIHtcbiAgLy8gTm90ZTogY2Fubm90IHVzZSBgbGVuZ3RoIDwgS19NQVhfTEVOR1RIYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IEtfTUFYX0xFTkdUSCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICdzaXplOiAweCcgKyBLX01BWF9MRU5HVEgudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAobGVuZ3RoKSB7XG4gIGlmICgrbGVuZ3RoICE9IGxlbmd0aCkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGVxZXFlcVxuICAgIGxlbmd0aCA9IDBcbiAgfVxuICByZXR1cm4gQnVmZmVyLmFsbG9jKCtsZW5ndGgpXG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIGlzQnVmZmVyIChiKSB7XG4gIHJldHVybiBiICE9IG51bGwgJiYgYi5faXNCdWZmZXIgPT09IHRydWUgJiZcbiAgICBiICE9PSBCdWZmZXIucHJvdG90eXBlIC8vIHNvIEJ1ZmZlci5pc0J1ZmZlcihCdWZmZXIucHJvdG90eXBlKSB3aWxsIGJlIGZhbHNlXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYSwgYikge1xuICBpZiAoaXNJbnN0YW5jZShhLCBVaW50OEFycmF5KSkgYSA9IEJ1ZmZlci5mcm9tKGEsIGEub2Zmc2V0LCBhLmJ5dGVMZW5ndGgpXG4gIGlmIChpc0luc3RhbmNlKGIsIFVpbnQ4QXJyYXkpKSBiID0gQnVmZmVyLmZyb20oYiwgYi5vZmZzZXQsIGIuYnl0ZUxlbmd0aClcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAnVGhlIFwiYnVmMVwiLCBcImJ1ZjJcIiBhcmd1bWVudHMgbXVzdCBiZSBvbmUgb2YgdHlwZSBCdWZmZXIgb3IgVWludDhBcnJheSdcbiAgICApXG4gIH1cblxuICBpZiAoYSA9PT0gYikgcmV0dXJuIDBcblxuICB2YXIgeCA9IGEubGVuZ3RoXG4gIHZhciB5ID0gYi5sZW5ndGhcblxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gTWF0aC5taW4oeCwgeSk7IGkgPCBsZW47ICsraSkge1xuICAgIGlmIChhW2ldICE9PSBiW2ldKSB7XG4gICAgICB4ID0gYVtpXVxuICAgICAgeSA9IGJbaV1cbiAgICAgIGJyZWFrXG4gICAgfVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIGlzRW5jb2RpbmcgKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2xhdGluMSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gY29uY2F0IChsaXN0LCBsZW5ndGgpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGxpc3QpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJsaXN0XCIgYXJndW1lbnQgbXVzdCBiZSBhbiBBcnJheSBvZiBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBCdWZmZXIuYWxsb2MoMClcbiAgfVxuXG4gIHZhciBpXG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIGxlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7ICsraSkge1xuICAgICAgbGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZmZlciA9IEJ1ZmZlci5hbGxvY1Vuc2FmZShsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgKytpKSB7XG4gICAgdmFyIGJ1ZiA9IGxpc3RbaV1cbiAgICBpZiAoaXNJbnN0YW5jZShidWYsIFVpbnQ4QXJyYXkpKSB7XG4gICAgICBidWYgPSBCdWZmZXIuZnJvbShidWYpXG4gICAgfVxuICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wibGlzdFwiIGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycycpXG4gICAgfVxuICAgIGJ1Zi5jb3B5KGJ1ZmZlciwgcG9zKVxuICAgIHBvcyArPSBidWYubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZmZlclxufVxuXG5mdW5jdGlvbiBieXRlTGVuZ3RoIChzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIoc3RyaW5nKSkge1xuICAgIHJldHVybiBzdHJpbmcubGVuZ3RoXG4gIH1cbiAgaWYgKEFycmF5QnVmZmVyLmlzVmlldyhzdHJpbmcpIHx8IGlzSW5zdGFuY2Uoc3RyaW5nLCBBcnJheUJ1ZmZlcikpIHtcbiAgICByZXR1cm4gc3RyaW5nLmJ5dGVMZW5ndGhcbiAgfVxuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgJ1RoZSBcInN0cmluZ1wiIGFyZ3VtZW50IG11c3QgYmUgb25lIG9mIHR5cGUgc3RyaW5nLCBCdWZmZXIsIG9yIEFycmF5QnVmZmVyLiAnICtcbiAgICAgICdSZWNlaXZlZCB0eXBlICcgKyB0eXBlb2Ygc3RyaW5nXG4gICAgKVxuICB9XG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgdmFyIG11c3RNYXRjaCA9IChhcmd1bWVudHMubGVuZ3RoID4gMiAmJiBhcmd1bWVudHNbMl0gPT09IHRydWUpXG4gIGlmICghbXVzdE1hdGNoICYmIGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2xhdGluMSc6XG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gbGVuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gbGVuICogMlxuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGxlbiA+Pj4gMVxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkge1xuICAgICAgICAgIHJldHVybiBtdXN0TWF0Y2ggPyAtMSA6IHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoIC8vIGFzc3VtZSB1dGY4XG4gICAgICAgIH1cbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG5mdW5jdGlvbiBzbG93VG9TdHJpbmcgKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgLy8gTm8gbmVlZCB0byB2ZXJpZnkgdGhhdCBcInRoaXMubGVuZ3RoIDw9IE1BWF9VSU5UMzJcIiBzaW5jZSBpdCdzIGEgcmVhZC1vbmx5XG4gIC8vIHByb3BlcnR5IG9mIGEgdHlwZWQgYXJyYXkuXG5cbiAgLy8gVGhpcyBiZWhhdmVzIG5laXRoZXIgbGlrZSBTdHJpbmcgbm9yIFVpbnQ4QXJyYXkgaW4gdGhhdCB3ZSBzZXQgc3RhcnQvZW5kXG4gIC8vIHRvIHRoZWlyIHVwcGVyL2xvd2VyIGJvdW5kcyBpZiB0aGUgdmFsdWUgcGFzc2VkIGlzIG91dCBvZiByYW5nZS5cbiAgLy8gdW5kZWZpbmVkIGlzIGhhbmRsZWQgc3BlY2lhbGx5IGFzIHBlciBFQ01BLTI2MiA2dGggRWRpdGlvbixcbiAgLy8gU2VjdGlvbiAxMy4zLjMuNyBSdW50aW1lIFNlbWFudGljczogS2V5ZWRCaW5kaW5nSW5pdGlhbGl6YXRpb24uXG4gIGlmIChzdGFydCA9PT0gdW5kZWZpbmVkIHx8IHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ID0gMFxuICB9XG4gIC8vIFJldHVybiBlYXJseSBpZiBzdGFydCA+IHRoaXMubGVuZ3RoLiBEb25lIGhlcmUgdG8gcHJldmVudCBwb3RlbnRpYWwgdWludDMyXG4gIC8vIGNvZXJjaW9uIGZhaWwgYmVsb3cuXG4gIGlmIChzdGFydCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuICcnXG4gIH1cblxuICBpZiAoZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHtcbiAgICBlbmQgPSB0aGlzLmxlbmd0aFxuICB9XG5cbiAgaWYgKGVuZCA8PSAwKSB7XG4gICAgcmV0dXJuICcnXG4gIH1cblxuICAvLyBGb3JjZSBjb2Vyc2lvbiB0byB1aW50MzIuIFRoaXMgd2lsbCBhbHNvIGNvZXJjZSBmYWxzZXkvTmFOIHZhbHVlcyB0byAwLlxuICBlbmQgPj4+PSAwXG4gIHN0YXJ0ID4+Pj0gMFxuXG4gIGlmIChlbmQgPD0gc3RhcnQpIHtcbiAgICByZXR1cm4gJydcbiAgfVxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdsYXRpbjEnOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGxhdGluMVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG4vLyBUaGlzIHByb3BlcnR5IGlzIHVzZWQgYnkgYEJ1ZmZlci5pc0J1ZmZlcmAgKGFuZCB0aGUgYGlzLWJ1ZmZlcmAgbnBtIHBhY2thZ2UpXG4vLyB0byBkZXRlY3QgYSBCdWZmZXIgaW5zdGFuY2UuIEl0J3Mgbm90IHBvc3NpYmxlIHRvIHVzZSBgaW5zdGFuY2VvZiBCdWZmZXJgXG4vLyByZWxpYWJseSBpbiBhIGJyb3dzZXJpZnkgY29udGV4dCBiZWNhdXNlIHRoZXJlIGNvdWxkIGJlIG11bHRpcGxlIGRpZmZlcmVudFxuLy8gY29waWVzIG9mIHRoZSAnYnVmZmVyJyBwYWNrYWdlIGluIHVzZS4gVGhpcyBtZXRob2Qgd29ya3MgZXZlbiBmb3IgQnVmZmVyXG4vLyBpbnN0YW5jZXMgdGhhdCB3ZXJlIGNyZWF0ZWQgZnJvbSBhbm90aGVyIGNvcHkgb2YgdGhlIGBidWZmZXJgIHBhY2thZ2UuXG4vLyBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9mZXJvc3MvYnVmZmVyL2lzc3Vlcy8xNTRcbkJ1ZmZlci5wcm90b3R5cGUuX2lzQnVmZmVyID0gdHJ1ZVxuXG5mdW5jdGlvbiBzd2FwIChiLCBuLCBtKSB7XG4gIHZhciBpID0gYltuXVxuICBiW25dID0gYlttXVxuICBiW21dID0gaVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnN3YXAxNiA9IGZ1bmN0aW9uIHN3YXAxNiAoKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBpZiAobGVuICUgMiAhPT0gMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdCdWZmZXIgc2l6ZSBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgMTYtYml0cycpXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkgKz0gMikge1xuICAgIHN3YXAodGhpcywgaSwgaSArIDEpXG4gIH1cbiAgcmV0dXJuIHRoaXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zd2FwMzIgPSBmdW5jdGlvbiBzd2FwMzIgKCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgaWYgKGxlbiAlIDQgIT09IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQnVmZmVyIHNpemUgbXVzdCBiZSBhIG11bHRpcGxlIG9mIDMyLWJpdHMnKVxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpICs9IDQpIHtcbiAgICBzd2FwKHRoaXMsIGksIGkgKyAzKVxuICAgIHN3YXAodGhpcywgaSArIDEsIGkgKyAyKVxuICB9XG4gIHJldHVybiB0aGlzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc3dhcDY0ID0gZnVuY3Rpb24gc3dhcDY0ICgpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIGlmIChsZW4gJSA4ICE9PSAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0J1ZmZlciBzaXplIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA2NC1iaXRzJylcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSArPSA4KSB7XG4gICAgc3dhcCh0aGlzLCBpLCBpICsgNylcbiAgICBzd2FwKHRoaXMsIGkgKyAxLCBpICsgNilcbiAgICBzd2FwKHRoaXMsIGkgKyAyLCBpICsgNSlcbiAgICBzd2FwKHRoaXMsIGkgKyAzLCBpICsgNClcbiAgfVxuICByZXR1cm4gdGhpc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcgKCkge1xuICB2YXIgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9Mb2NhbGVTdHJpbmcgPSBCdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nXG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkucmVwbGFjZSgvKC57Mn0pL2csICckMSAnKS50cmltKClcbiAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KSBzdHIgKz0gJyAuLi4gJ1xuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlICh0YXJnZXQsIHN0YXJ0LCBlbmQsIHRoaXNTdGFydCwgdGhpc0VuZCkge1xuICBpZiAoaXNJbnN0YW5jZSh0YXJnZXQsIFVpbnQ4QXJyYXkpKSB7XG4gICAgdGFyZ2V0ID0gQnVmZmVyLmZyb20odGFyZ2V0LCB0YXJnZXQub2Zmc2V0LCB0YXJnZXQuYnl0ZUxlbmd0aClcbiAgfVxuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcih0YXJnZXQpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICdUaGUgXCJ0YXJnZXRcIiBhcmd1bWVudCBtdXN0IGJlIG9uZSBvZiB0eXBlIEJ1ZmZlciBvciBVaW50OEFycmF5LiAnICtcbiAgICAgICdSZWNlaXZlZCB0eXBlICcgKyAodHlwZW9mIHRhcmdldClcbiAgICApXG4gIH1cblxuICBpZiAoc3RhcnQgPT09IHVuZGVmaW5lZCkge1xuICAgIHN0YXJ0ID0gMFxuICB9XG4gIGlmIChlbmQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuZCA9IHRhcmdldCA/IHRhcmdldC5sZW5ndGggOiAwXG4gIH1cbiAgaWYgKHRoaXNTdGFydCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhpc1N0YXJ0ID0gMFxuICB9XG4gIGlmICh0aGlzRW5kID09PSB1bmRlZmluZWQpIHtcbiAgICB0aGlzRW5kID0gdGhpcy5sZW5ndGhcbiAgfVxuXG4gIGlmIChzdGFydCA8IDAgfHwgZW5kID4gdGFyZ2V0Lmxlbmd0aCB8fCB0aGlzU3RhcnQgPCAwIHx8IHRoaXNFbmQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdvdXQgb2YgcmFuZ2UgaW5kZXgnKVxuICB9XG5cbiAgaWYgKHRoaXNTdGFydCA+PSB0aGlzRW5kICYmIHN0YXJ0ID49IGVuZCkge1xuICAgIHJldHVybiAwXG4gIH1cbiAgaWYgKHRoaXNTdGFydCA+PSB0aGlzRW5kKSB7XG4gICAgcmV0dXJuIC0xXG4gIH1cbiAgaWYgKHN0YXJ0ID49IGVuZCkge1xuICAgIHJldHVybiAxXG4gIH1cblxuICBzdGFydCA+Pj49IDBcbiAgZW5kID4+Pj0gMFxuICB0aGlzU3RhcnQgPj4+PSAwXG4gIHRoaXNFbmQgPj4+PSAwXG5cbiAgaWYgKHRoaXMgPT09IHRhcmdldCkgcmV0dXJuIDBcblxuICB2YXIgeCA9IHRoaXNFbmQgLSB0aGlzU3RhcnRcbiAgdmFyIHkgPSBlbmQgLSBzdGFydFxuICB2YXIgbGVuID0gTWF0aC5taW4oeCwgeSlcblxuICB2YXIgdGhpc0NvcHkgPSB0aGlzLnNsaWNlKHRoaXNTdGFydCwgdGhpc0VuZClcbiAgdmFyIHRhcmdldENvcHkgPSB0YXJnZXQuc2xpY2Uoc3RhcnQsIGVuZClcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgKytpKSB7XG4gICAgaWYgKHRoaXNDb3B5W2ldICE9PSB0YXJnZXRDb3B5W2ldKSB7XG4gICAgICB4ID0gdGhpc0NvcHlbaV1cbiAgICAgIHkgPSB0YXJnZXRDb3B5W2ldXG4gICAgICBicmVha1xuICAgIH1cbiAgfVxuXG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuLy8gRmluZHMgZWl0aGVyIHRoZSBmaXJzdCBpbmRleCBvZiBgdmFsYCBpbiBgYnVmZmVyYCBhdCBvZmZzZXQgPj0gYGJ5dGVPZmZzZXRgLFxuLy8gT1IgdGhlIGxhc3QgaW5kZXggb2YgYHZhbGAgaW4gYGJ1ZmZlcmAgYXQgb2Zmc2V0IDw9IGBieXRlT2Zmc2V0YC5cbi8vXG4vLyBBcmd1bWVudHM6XG4vLyAtIGJ1ZmZlciAtIGEgQnVmZmVyIHRvIHNlYXJjaFxuLy8gLSB2YWwgLSBhIHN0cmluZywgQnVmZmVyLCBvciBudW1iZXJcbi8vIC0gYnl0ZU9mZnNldCAtIGFuIGluZGV4IGludG8gYGJ1ZmZlcmA7IHdpbGwgYmUgY2xhbXBlZCB0byBhbiBpbnQzMlxuLy8gLSBlbmNvZGluZyAtIGFuIG9wdGlvbmFsIGVuY29kaW5nLCByZWxldmFudCBpcyB2YWwgaXMgYSBzdHJpbmdcbi8vIC0gZGlyIC0gdHJ1ZSBmb3IgaW5kZXhPZiwgZmFsc2UgZm9yIGxhc3RJbmRleE9mXG5mdW5jdGlvbiBiaWRpcmVjdGlvbmFsSW5kZXhPZiAoYnVmZmVyLCB2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nLCBkaXIpIHtcbiAgLy8gRW1wdHkgYnVmZmVyIG1lYW5zIG5vIG1hdGNoXG4gIGlmIChidWZmZXIubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcblxuICAvLyBOb3JtYWxpemUgYnl0ZU9mZnNldFxuICBpZiAodHlwZW9mIGJ5dGVPZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBieXRlT2Zmc2V0XG4gICAgYnl0ZU9mZnNldCA9IDBcbiAgfSBlbHNlIGlmIChieXRlT2Zmc2V0ID4gMHg3ZmZmZmZmZikge1xuICAgIGJ5dGVPZmZzZXQgPSAweDdmZmZmZmZmXG4gIH0gZWxzZSBpZiAoYnl0ZU9mZnNldCA8IC0weDgwMDAwMDAwKSB7XG4gICAgYnl0ZU9mZnNldCA9IC0weDgwMDAwMDAwXG4gIH1cbiAgYnl0ZU9mZnNldCA9ICtieXRlT2Zmc2V0IC8vIENvZXJjZSB0byBOdW1iZXIuXG4gIGlmIChudW1iZXJJc05hTihieXRlT2Zmc2V0KSkge1xuICAgIC8vIGJ5dGVPZmZzZXQ6IGl0IGl0J3MgdW5kZWZpbmVkLCBudWxsLCBOYU4sIFwiZm9vXCIsIGV0Yywgc2VhcmNoIHdob2xlIGJ1ZmZlclxuICAgIGJ5dGVPZmZzZXQgPSBkaXIgPyAwIDogKGJ1ZmZlci5sZW5ndGggLSAxKVxuICB9XG5cbiAgLy8gTm9ybWFsaXplIGJ5dGVPZmZzZXQ6IG5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gYnVmZmVyLmxlbmd0aCArIGJ5dGVPZmZzZXRcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gYnVmZmVyLmxlbmd0aCkge1xuICAgIGlmIChkaXIpIHJldHVybiAtMVxuICAgIGVsc2UgYnl0ZU9mZnNldCA9IGJ1ZmZlci5sZW5ndGggLSAxXG4gIH0gZWxzZSBpZiAoYnl0ZU9mZnNldCA8IDApIHtcbiAgICBpZiAoZGlyKSBieXRlT2Zmc2V0ID0gMFxuICAgIGVsc2UgcmV0dXJuIC0xXG4gIH1cblxuICAvLyBOb3JtYWxpemUgdmFsXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIHZhbCA9IEJ1ZmZlci5mcm9tKHZhbCwgZW5jb2RpbmcpXG4gIH1cblxuICAvLyBGaW5hbGx5LCBzZWFyY2ggZWl0aGVyIGluZGV4T2YgKGlmIGRpciBpcyB0cnVlKSBvciBsYXN0SW5kZXhPZlxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICAvLyBTcGVjaWFsIGNhc2U6IGxvb2tpbmcgZm9yIGVtcHR5IHN0cmluZy9idWZmZXIgYWx3YXlzIGZhaWxzXG4gICAgaWYgKHZhbC5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiAtMVxuICAgIH1cbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKGJ1ZmZlciwgdmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZywgZGlyKVxuICB9IGVsc2UgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgdmFsID0gdmFsICYgMHhGRiAvLyBTZWFyY2ggZm9yIGEgYnl0ZSB2YWx1ZSBbMC0yNTVdXG4gICAgaWYgKHR5cGVvZiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBpZiAoZGlyKSB7XG4gICAgICAgIHJldHVybiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mLmNhbGwoYnVmZmVyLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gVWludDhBcnJheS5wcm90b3R5cGUubGFzdEluZGV4T2YuY2FsbChidWZmZXIsIHZhbCwgYnl0ZU9mZnNldClcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZihidWZmZXIsIFsgdmFsIF0sIGJ5dGVPZmZzZXQsIGVuY29kaW5nLCBkaXIpXG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWwgbXVzdCBiZSBzdHJpbmcsIG51bWJlciBvciBCdWZmZXInKVxufVxuXG5mdW5jdGlvbiBhcnJheUluZGV4T2YgKGFyciwgdmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZywgZGlyKSB7XG4gIHZhciBpbmRleFNpemUgPSAxXG4gIHZhciBhcnJMZW5ndGggPSBhcnIubGVuZ3RoXG4gIHZhciB2YWxMZW5ndGggPSB2YWwubGVuZ3RoXG5cbiAgaWYgKGVuY29kaW5nICE9PSB1bmRlZmluZWQpIHtcbiAgICBlbmNvZGluZyA9IFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgIGlmIChlbmNvZGluZyA9PT0gJ3VjczInIHx8IGVuY29kaW5nID09PSAndWNzLTInIHx8XG4gICAgICAgIGVuY29kaW5nID09PSAndXRmMTZsZScgfHwgZW5jb2RpbmcgPT09ICd1dGYtMTZsZScpIHtcbiAgICAgIGlmIChhcnIubGVuZ3RoIDwgMiB8fCB2YWwubGVuZ3RoIDwgMikge1xuICAgICAgICByZXR1cm4gLTFcbiAgICAgIH1cbiAgICAgIGluZGV4U2l6ZSA9IDJcbiAgICAgIGFyckxlbmd0aCAvPSAyXG4gICAgICB2YWxMZW5ndGggLz0gMlxuICAgICAgYnl0ZU9mZnNldCAvPSAyXG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcmVhZCAoYnVmLCBpKSB7XG4gICAgaWYgKGluZGV4U2l6ZSA9PT0gMSkge1xuICAgICAgcmV0dXJuIGJ1ZltpXVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYnVmLnJlYWRVSW50MTZCRShpICogaW5kZXhTaXplKVxuICAgIH1cbiAgfVxuXG4gIHZhciBpXG4gIGlmIChkaXIpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yIChpID0gYnl0ZU9mZnNldDsgaSA8IGFyckxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAocmVhZChhcnIsIGkpID09PSByZWFkKHZhbCwgZm91bmRJbmRleCA9PT0gLTEgPyAwIDogaSAtIGZvdW5kSW5kZXgpKSB7XG4gICAgICAgIGlmIChmb3VuZEluZGV4ID09PSAtMSkgZm91bmRJbmRleCA9IGlcbiAgICAgICAgaWYgKGkgLSBmb3VuZEluZGV4ICsgMSA9PT0gdmFsTGVuZ3RoKSByZXR1cm4gZm91bmRJbmRleCAqIGluZGV4U2l6ZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGZvdW5kSW5kZXggIT09IC0xKSBpIC09IGkgLSBmb3VuZEluZGV4XG4gICAgICAgIGZvdW5kSW5kZXggPSAtMVxuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoYnl0ZU9mZnNldCArIHZhbExlbmd0aCA+IGFyckxlbmd0aCkgYnl0ZU9mZnNldCA9IGFyckxlbmd0aCAtIHZhbExlbmd0aFxuICAgIGZvciAoaSA9IGJ5dGVPZmZzZXQ7IGkgPj0gMDsgaS0tKSB7XG4gICAgICB2YXIgZm91bmQgPSB0cnVlXG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHZhbExlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmIChyZWFkKGFyciwgaSArIGopICE9PSByZWFkKHZhbCwgaikpIHtcbiAgICAgICAgICBmb3VuZCA9IGZhbHNlXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGZvdW5kKSByZXR1cm4gaVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiAtMVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluY2x1ZGVzID0gZnVuY3Rpb24gaW5jbHVkZXMgKHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcpIHtcbiAgcmV0dXJuIHRoaXMuaW5kZXhPZih2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nKSAhPT0gLTFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbmRleE9mID0gZnVuY3Rpb24gaW5kZXhPZiAodmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZykge1xuICByZXR1cm4gYmlkaXJlY3Rpb25hbEluZGV4T2YodGhpcywgdmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZywgdHJ1ZSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5sYXN0SW5kZXhPZiA9IGZ1bmN0aW9uIGxhc3RJbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nKSB7XG4gIHJldHVybiBiaWRpcmVjdGlvbmFsSW5kZXhPZih0aGlzLCB2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nLCBmYWxzZSlcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICB2YXIgcGFyc2VkID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChudW1iZXJJc05hTihwYXJzZWQpKSByZXR1cm4gaVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IHBhcnNlZFxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gbGF0aW4xV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiB1Y3MyV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcpXG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgb2Zmc2V0WywgbGVuZ3RoXVssIGVuY29kaW5nXSlcbiAgfSBlbHNlIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCA+Pj4gMFxuICAgICAgaWYgKGVuY29kaW5nID09PSB1bmRlZmluZWQpIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ0J1ZmZlci53cml0ZShzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXRbLCBsZW5ndGhdKSBpcyBubyBsb25nZXIgc3VwcG9ydGVkJ1xuICAgIClcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdsYXRpbjEnOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGxhdGluMVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICAgIHJldHVybiBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdWNzMldyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcbiAgdmFyIHJlcyA9IFtdXG5cbiAgdmFyIGkgPSBzdGFydFxuICB3aGlsZSAoaSA8IGVuZCkge1xuICAgIHZhciBmaXJzdEJ5dGUgPSBidWZbaV1cbiAgICB2YXIgY29kZVBvaW50ID0gbnVsbFxuICAgIHZhciBieXRlc1BlclNlcXVlbmNlID0gKGZpcnN0Qnl0ZSA+IDB4RUYpID8gNFxuICAgICAgOiAoZmlyc3RCeXRlID4gMHhERikgPyAzXG4gICAgICAgIDogKGZpcnN0Qnl0ZSA+IDB4QkYpID8gMlxuICAgICAgICAgIDogMVxuXG4gICAgaWYgKGkgKyBieXRlc1BlclNlcXVlbmNlIDw9IGVuZCkge1xuICAgICAgdmFyIHNlY29uZEJ5dGUsIHRoaXJkQnl0ZSwgZm91cnRoQnl0ZSwgdGVtcENvZGVQb2ludFxuXG4gICAgICBzd2l0Y2ggKGJ5dGVzUGVyU2VxdWVuY2UpIHtcbiAgICAgICAgY2FzZSAxOlxuICAgICAgICAgIGlmIChmaXJzdEJ5dGUgPCAweDgwKSB7XG4gICAgICAgICAgICBjb2RlUG9pbnQgPSBmaXJzdEJ5dGVcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAyOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHgxRikgPDwgMHg2IHwgKHNlY29uZEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweDdGKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAzOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwICYmICh0aGlyZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweEYpIDw8IDB4QyB8IChzZWNvbmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKHRoaXJkQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4N0ZGICYmICh0ZW1wQ29kZVBvaW50IDwgMHhEODAwIHx8IHRlbXBDb2RlUG9pbnQgPiAweERGRkYpKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSA0OlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGZvdXJ0aEJ5dGUgPSBidWZbaSArIDNdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKHRoaXJkQnl0ZSAmIDB4QzApID09PSAweDgwICYmIChmb3VydGhCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHhGKSA8PCAweDEyIHwgKHNlY29uZEJ5dGUgJiAweDNGKSA8PCAweEMgfCAodGhpcmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKGZvdXJ0aEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweEZGRkYgJiYgdGVtcENvZGVQb2ludCA8IDB4MTEwMDAwKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvZGVQb2ludCA9PT0gbnVsbCkge1xuICAgICAgLy8gd2UgZGlkIG5vdCBnZW5lcmF0ZSBhIHZhbGlkIGNvZGVQb2ludCBzbyBpbnNlcnQgYVxuICAgICAgLy8gcmVwbGFjZW1lbnQgY2hhciAoVStGRkZEKSBhbmQgYWR2YW5jZSBvbmx5IDEgYnl0ZVxuICAgICAgY29kZVBvaW50ID0gMHhGRkZEXG4gICAgICBieXRlc1BlclNlcXVlbmNlID0gMVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50ID4gMHhGRkZGKSB7XG4gICAgICAvLyBlbmNvZGUgdG8gdXRmMTYgKHN1cnJvZ2F0ZSBwYWlyIGRhbmNlKVxuICAgICAgY29kZVBvaW50IC09IDB4MTAwMDBcbiAgICAgIHJlcy5wdXNoKGNvZGVQb2ludCA+Pj4gMTAgJiAweDNGRiB8IDB4RDgwMClcbiAgICAgIGNvZGVQb2ludCA9IDB4REMwMCB8IGNvZGVQb2ludCAmIDB4M0ZGXG4gICAgfVxuXG4gICAgcmVzLnB1c2goY29kZVBvaW50KVxuICAgIGkgKz0gYnl0ZXNQZXJTZXF1ZW5jZVxuICB9XG5cbiAgcmV0dXJuIGRlY29kZUNvZGVQb2ludHNBcnJheShyZXMpXG59XG5cbi8vIEJhc2VkIG9uIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzIyNzQ3MjcyLzY4MDc0MiwgdGhlIGJyb3dzZXIgd2l0aFxuLy8gdGhlIGxvd2VzdCBsaW1pdCBpcyBDaHJvbWUsIHdpdGggMHgxMDAwMCBhcmdzLlxuLy8gV2UgZ28gMSBtYWduaXR1ZGUgbGVzcywgZm9yIHNhZmV0eVxudmFyIE1BWF9BUkdVTUVOVFNfTEVOR1RIID0gMHgxMDAwXG5cbmZ1bmN0aW9uIGRlY29kZUNvZGVQb2ludHNBcnJheSAoY29kZVBvaW50cykge1xuICB2YXIgbGVuID0gY29kZVBvaW50cy5sZW5ndGhcbiAgaWYgKGxlbiA8PSBNQVhfQVJHVU1FTlRTX0xFTkdUSCkge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KFN0cmluZywgY29kZVBvaW50cykgLy8gYXZvaWQgZXh0cmEgc2xpY2UoKVxuICB9XG5cbiAgLy8gRGVjb2RlIGluIGNodW5rcyB0byBhdm9pZCBcImNhbGwgc3RhY2sgc2l6ZSBleGNlZWRlZFwiLlxuICB2YXIgcmVzID0gJydcbiAgdmFyIGkgPSAwXG4gIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkoXG4gICAgICBTdHJpbmcsXG4gICAgICBjb2RlUG9pbnRzLnNsaWNlKGksIGkgKz0gTUFYX0FSR1VNRU5UU19MRU5HVEgpXG4gICAgKVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyArK2kpIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0gJiAweDdGKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gbGF0aW4xU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgKytpKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7ICsraSkge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiB1dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIChieXRlc1tpICsgMV0gKiAyNTYpKVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIHNsaWNlIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW5cbiAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMCkgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIHZhciBuZXdCdWYgPSB0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpXG4gIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlXG4gIG5ld0J1Zi5fX3Byb3RvX18gPSBCdWZmZXIucHJvdG90eXBlXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50QkUgPSBmdW5jdGlvbiByZWFkVUludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcbiAgfVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF1cbiAgdmFyIG11bCA9IDFcbiAgd2hpbGUgKGJ5dGVMZW5ndGggPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIHJlYWRVSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCA4KSB8IHRoaXNbb2Zmc2V0ICsgMV1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiByZWFkVUludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRMRSA9IGZ1bmN0aW9uIHJlYWRJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50QkUgPSBmdW5jdGlvbiByZWFkSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gcmVhZEludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gcmVhZEludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdExFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiByZWFkRG91YmxlTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiByZWFkRG91YmxlQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJidWZmZXJcIiBhcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignXCJ2YWx1ZVwiIGFyZ3VtZW50IGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbWF4Qnl0ZXMgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCkgLSAxXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbWF4Qnl0ZXMsIDApXG4gIH1cblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIG1heEJ5dGVzID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpIC0gMVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG1heEJ5dGVzLCAwKVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVVSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgKDggKiBieXRlTGVuZ3RoKSAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gMFxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICBpZiAodmFsdWUgPCAwICYmIHN1YiA9PT0gMCAmJiB0aGlzW29mZnNldCArIGkgLSAxXSAhPT0gMCkge1xuICAgICAgc3ViID0gMVxuICAgIH1cbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsICg4ICogYnl0ZUxlbmd0aCkgLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgaWYgKHZhbHVlIDwgMCAmJiBzdWIgPT09IDAgJiYgdGhpc1tvZmZzZXQgKyBpICsgMV0gIT09IDApIHtcbiAgICAgIHN1YiA9IDFcbiAgICB9XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiB3cml0ZUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlICYgMHhmZilcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgJiAweGZmKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5mdW5jdGlvbiBjaGVja0lFRUU3NTQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0luZGV4IG91dCBvZiByYW5nZScpXG4gIGlmIChvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignSW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gd3JpdGVGbG9hdExFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcih0YXJnZXQpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdhcmd1bWVudCBzaG91bGQgYmUgYSBCdWZmZXInKVxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignSW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0IDwgZW5kIC0gc3RhcnQpIHtcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgKyBzdGFydFxuICB9XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG5cbiAgaWYgKHRoaXMgPT09IHRhcmdldCAmJiB0eXBlb2YgVWludDhBcnJheS5wcm90b3R5cGUuY29weVdpdGhpbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIC8vIFVzZSBidWlsdC1pbiB3aGVuIGF2YWlsYWJsZSwgbWlzc2luZyBmcm9tIElFMTFcbiAgICB0aGlzLmNvcHlXaXRoaW4odGFyZ2V0U3RhcnQsIHN0YXJ0LCBlbmQpXG4gIH0gZWxzZSBpZiAodGhpcyA9PT0gdGFyZ2V0ICYmIHN0YXJ0IDwgdGFyZ2V0U3RhcnQgJiYgdGFyZ2V0U3RhcnQgPCBlbmQpIHtcbiAgICAvLyBkZXNjZW5kaW5nIGNvcHkgZnJvbSBlbmRcbiAgICBmb3IgKHZhciBpID0gbGVuIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIFVpbnQ4QXJyYXkucHJvdG90eXBlLnNldC5jYWxsKFxuICAgICAgdGFyZ2V0LFxuICAgICAgdGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSxcbiAgICAgIHRhcmdldFN0YXJ0XG4gICAgKVxuICB9XG5cbiAgcmV0dXJuIGxlblxufVxuXG4vLyBVc2FnZTpcbi8vICAgIGJ1ZmZlci5maWxsKG51bWJlclssIG9mZnNldFssIGVuZF1dKVxuLy8gICAgYnVmZmVyLmZpbGwoYnVmZmVyWywgb2Zmc2V0WywgZW5kXV0pXG4vLyAgICBidWZmZXIuZmlsbChzdHJpbmdbLCBvZmZzZXRbLCBlbmRdXVssIGVuY29kaW5nXSlcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uIGZpbGwgKHZhbCwgc3RhcnQsIGVuZCwgZW5jb2RpbmcpIHtcbiAgLy8gSGFuZGxlIHN0cmluZyBjYXNlczpcbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKHR5cGVvZiBzdGFydCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGVuY29kaW5nID0gc3RhcnRcbiAgICAgIHN0YXJ0ID0gMFxuICAgICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBlbmQgPT09ICdzdHJpbmcnKSB7XG4gICAgICBlbmNvZGluZyA9IGVuZFxuICAgICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgICB9XG4gICAgaWYgKGVuY29kaW5nICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGVuY29kaW5nICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZW5jb2RpbmcgbXVzdCBiZSBhIHN0cmluZycpXG4gICAgfVxuICAgIGlmICh0eXBlb2YgZW5jb2RpbmcgPT09ICdzdHJpbmcnICYmICFCdWZmZXIuaXNFbmNvZGluZyhlbmNvZGluZykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICB9XG4gICAgaWYgKHZhbC5sZW5ndGggPT09IDEpIHtcbiAgICAgIHZhciBjb2RlID0gdmFsLmNoYXJDb2RlQXQoMClcbiAgICAgIGlmICgoZW5jb2RpbmcgPT09ICd1dGY4JyAmJiBjb2RlIDwgMTI4KSB8fFxuICAgICAgICAgIGVuY29kaW5nID09PSAnbGF0aW4xJykge1xuICAgICAgICAvLyBGYXN0IHBhdGg6IElmIGB2YWxgIGZpdHMgaW50byBhIHNpbmdsZSBieXRlLCB1c2UgdGhhdCBudW1lcmljIHZhbHVlLlxuICAgICAgICB2YWwgPSBjb2RlXG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgdmFsID0gdmFsICYgMjU1XG4gIH1cblxuICAvLyBJbnZhbGlkIHJhbmdlcyBhcmUgbm90IHNldCB0byBhIGRlZmF1bHQsIHNvIGNhbiByYW5nZSBjaGVjayBlYXJseS5cbiAgaWYgKHN0YXJ0IDwgMCB8fCB0aGlzLmxlbmd0aCA8IHN0YXJ0IHx8IHRoaXMubGVuZ3RoIDwgZW5kKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ091dCBvZiByYW5nZSBpbmRleCcpXG4gIH1cblxuICBpZiAoZW5kIDw9IHN0YXJ0KSB7XG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHN0YXJ0ID0gc3RhcnQgPj4+IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyB0aGlzLmxlbmd0aCA6IGVuZCA+Pj4gMFxuXG4gIGlmICghdmFsKSB2YWwgPSAwXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7ICsraSkge1xuICAgICAgdGhpc1tpXSA9IHZhbFxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSBCdWZmZXIuaXNCdWZmZXIodmFsKVxuICAgICAgPyB2YWxcbiAgICAgIDogQnVmZmVyLmZyb20odmFsLCBlbmNvZGluZylcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgaWYgKGxlbiA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVGhlIHZhbHVlIFwiJyArIHZhbCArXG4gICAgICAgICdcIiBpcyBpbnZhbGlkIGZvciBhcmd1bWVudCBcInZhbHVlXCInKVxuICAgIH1cbiAgICBmb3IgKGkgPSAwOyBpIDwgZW5kIC0gc3RhcnQ7ICsraSkge1xuICAgICAgdGhpc1tpICsgc3RhcnRdID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXisvMC05QS1aYS16LV9dL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHRha2VzIGVxdWFsIHNpZ25zIGFzIGVuZCBvZiB0aGUgQmFzZTY0IGVuY29kaW5nXG4gIHN0ciA9IHN0ci5zcGxpdCgnPScpWzBdXG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHIudHJpbSgpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGNvbnZlcnRzIHN0cmluZ3Mgd2l0aCBsZW5ndGggPCAyIHRvICcnXG4gIGlmIChzdHIubGVuZ3RoIDwgMikgcmV0dXJuICcnXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMgKHN0cmluZywgdW5pdHMpIHtcbiAgdW5pdHMgPSB1bml0cyB8fCBJbmZpbml0eVxuICB2YXIgY29kZVBvaW50XG4gIHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoXG4gIHZhciBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICB2YXIgYnl0ZXMgPSBbXVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCFsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPiAweERCRkYpIHtcbiAgICAgICAgICAvLyB1bmV4cGVjdGVkIHRyYWlsXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIGlmIChpICsgMSA9PT0gbGVuZ3RoKSB7XG4gICAgICAgICAgLy8gdW5wYWlyZWQgbGVhZFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIHZhbGlkIHN1cnJvZ2F0ZSBwYWlyXG4gICAgICBjb2RlUG9pbnQgPSAobGVhZFN1cnJvZ2F0ZSAtIDB4RDgwMCA8PCAxMCB8IGNvZGVQb2ludCAtIDB4REMwMCkgKyAweDEwMDAwXG4gICAgfSBlbHNlIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAvLyB2YWxpZCBibXAgY2hhciwgYnV0IGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICB9XG5cbiAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuXG4gICAgLy8gZW5jb2RlIHV0ZjhcbiAgICBpZiAoY29kZVBvaW50IDwgMHg4MCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAxKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKGNvZGVQb2ludClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4ODAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgfCAweEMwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAzKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDIHwgMHhFMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gNCkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4MTIgfCAweEYwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvZGUgcG9pbnQnKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyArK2kpIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyLCB1bml0cykge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7ICsraSkge1xuICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuXG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoYmFzZTY0Y2xlYW4oc3RyKSlcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoKGkgKyBvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuLy8gQXJyYXlCdWZmZXIgb3IgVWludDhBcnJheSBvYmplY3RzIGZyb20gb3RoZXIgY29udGV4dHMgKGkuZS4gaWZyYW1lcykgZG8gbm90IHBhc3Ncbi8vIHRoZSBgaW5zdGFuY2VvZmAgY2hlY2sgYnV0IHRoZXkgc2hvdWxkIGJlIHRyZWF0ZWQgYXMgb2YgdGhhdCB0eXBlLlxuLy8gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vZmVyb3NzL2J1ZmZlci9pc3N1ZXMvMTY2XG5mdW5jdGlvbiBpc0luc3RhbmNlIChvYmosIHR5cGUpIHtcbiAgcmV0dXJuIG9iaiBpbnN0YW5jZW9mIHR5cGUgfHxcbiAgICAob2JqICE9IG51bGwgJiYgb2JqLmNvbnN0cnVjdG9yICE9IG51bGwgJiYgb2JqLmNvbnN0cnVjdG9yLm5hbWUgIT0gbnVsbCAmJlxuICAgICAgb2JqLmNvbnN0cnVjdG9yLm5hbWUgPT09IHR5cGUubmFtZSlcbn1cbmZ1bmN0aW9uIG51bWJlcklzTmFOIChvYmopIHtcbiAgLy8gRm9yIElFMTEgc3VwcG9ydFxuICByZXR1cm4gb2JqICE9PSBvYmogLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1zZWxmLWNvbXBhcmVcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZWxlbWVudCl7XG4gICAgdmFyIGxhc3RDbGFzc2VzID0gW107XG5cbiAgICByZXR1cm4gZnVuY3Rpb24oY2xhc3Nlcyl7XG5cbiAgICAgICAgaWYoIWFyZ3VtZW50cy5sZW5ndGgpe1xuICAgICAgICAgICAgcmV0dXJuIGxhc3RDbGFzc2VzLmpvaW4oJyAnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGNsZWFuQ2xhc3NOYW1lKHJlc3VsdCwgY2xhc3NOYW1lKXtcbiAgICAgICAgICAgIGlmKHR5cGVvZiBjbGFzc05hbWUgPT09ICdzdHJpbmcnICYmIGNsYXNzTmFtZS5tYXRjaCgvXFxzLykpe1xuICAgICAgICAgICAgICAgIGNsYXNzTmFtZSA9IGNsYXNzTmFtZS5zcGxpdCgnICcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihBcnJheS5pc0FycmF5KGNsYXNzTmFtZSkpe1xuICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQuY29uY2F0KGNsYXNzTmFtZS5yZWR1Y2UoY2xlYW5DbGFzc05hbWUsIFtdKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGNsYXNzTmFtZSAhPSBudWxsICYmIGNsYXNzTmFtZSAhPT0gJycgJiYgdHlwZW9mIGNsYXNzTmFtZSAhPT0gJ2Jvb2xlYW4nKXtcbiAgICAgICAgICAgICAgICByZXN1bHQucHVzaChTdHJpbmcoY2xhc3NOYW1lKS50cmltKCkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG5ld0NsYXNzZXMgPSBjbGVhbkNsYXNzTmFtZShbXSwgY2xhc3NlcyksXG4gICAgICAgICAgICBjdXJyZW50Q2xhc3NlcyA9IGVsZW1lbnQuY2xhc3NOYW1lID8gZWxlbWVudC5jbGFzc05hbWUuc3BsaXQoJyAnKSA6IFtdO1xuXG4gICAgICAgIGxhc3RDbGFzc2VzLm1hcChmdW5jdGlvbihjbGFzc05hbWUpe1xuICAgICAgICAgICAgaWYoIWNsYXNzTmFtZSl7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgaW5kZXggPSBjdXJyZW50Q2xhc3Nlcy5pbmRleE9mKGNsYXNzTmFtZSk7XG5cbiAgICAgICAgICAgIGlmKH5pbmRleCl7XG4gICAgICAgICAgICAgICAgY3VycmVudENsYXNzZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYobGFzdENsYXNzZXMuam9pbigpID09PSBuZXdDbGFzc2VzLmpvaW4oKSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjdXJyZW50Q2xhc3NlcyA9IGN1cnJlbnRDbGFzc2VzLmNvbmNhdChuZXdDbGFzc2VzKTtcbiAgICAgICAgbGFzdENsYXNzZXMgPSBuZXdDbGFzc2VzO1xuXG4gICAgICAgIGVsZW1lbnQuY2xhc3NOYW1lID0gY3VycmVudENsYXNzZXMuam9pbignICcpO1xuICAgIH07XG59O1xuIiwidmFyIGNsb25lID0gKGZ1bmN0aW9uKCkge1xuJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIENsb25lcyAoY29waWVzKSBhbiBPYmplY3QgdXNpbmcgZGVlcCBjb3B5aW5nLlxuICpcbiAqIFRoaXMgZnVuY3Rpb24gc3VwcG9ydHMgY2lyY3VsYXIgcmVmZXJlbmNlcyBieSBkZWZhdWx0LCBidXQgaWYgeW91IGFyZSBjZXJ0YWluXG4gKiB0aGVyZSBhcmUgbm8gY2lyY3VsYXIgcmVmZXJlbmNlcyBpbiB5b3VyIG9iamVjdCwgeW91IGNhbiBzYXZlIHNvbWUgQ1BVIHRpbWVcbiAqIGJ5IGNhbGxpbmcgY2xvbmUob2JqLCBmYWxzZSkuXG4gKlxuICogQ2F1dGlvbjogaWYgYGNpcmN1bGFyYCBpcyBmYWxzZSBhbmQgYHBhcmVudGAgY29udGFpbnMgY2lyY3VsYXIgcmVmZXJlbmNlcyxcbiAqIHlvdXIgcHJvZ3JhbSBtYXkgZW50ZXIgYW4gaW5maW5pdGUgbG9vcCBhbmQgY3Jhc2guXG4gKlxuICogQHBhcmFtIGBwYXJlbnRgIC0gdGhlIG9iamVjdCB0byBiZSBjbG9uZWRcbiAqIEBwYXJhbSBgY2lyY3VsYXJgIC0gc2V0IHRvIHRydWUgaWYgdGhlIG9iamVjdCB0byBiZSBjbG9uZWQgbWF5IGNvbnRhaW5cbiAqICAgIGNpcmN1bGFyIHJlZmVyZW5jZXMuIChvcHRpb25hbCAtIHRydWUgYnkgZGVmYXVsdClcbiAqIEBwYXJhbSBgZGVwdGhgIC0gc2V0IHRvIGEgbnVtYmVyIGlmIHRoZSBvYmplY3QgaXMgb25seSB0byBiZSBjbG9uZWQgdG9cbiAqICAgIGEgcGFydGljdWxhciBkZXB0aC4gKG9wdGlvbmFsIC0gZGVmYXVsdHMgdG8gSW5maW5pdHkpXG4gKiBAcGFyYW0gYHByb3RvdHlwZWAgLSBzZXRzIHRoZSBwcm90b3R5cGUgdG8gYmUgdXNlZCB3aGVuIGNsb25pbmcgYW4gb2JqZWN0LlxuICogICAgKG9wdGlvbmFsIC0gZGVmYXVsdHMgdG8gcGFyZW50IHByb3RvdHlwZSkuXG4qL1xuZnVuY3Rpb24gY2xvbmUocGFyZW50LCBjaXJjdWxhciwgZGVwdGgsIHByb3RvdHlwZSkge1xuICB2YXIgZmlsdGVyO1xuICBpZiAodHlwZW9mIGNpcmN1bGFyID09PSAnb2JqZWN0Jykge1xuICAgIGRlcHRoID0gY2lyY3VsYXIuZGVwdGg7XG4gICAgcHJvdG90eXBlID0gY2lyY3VsYXIucHJvdG90eXBlO1xuICAgIGZpbHRlciA9IGNpcmN1bGFyLmZpbHRlcjtcbiAgICBjaXJjdWxhciA9IGNpcmN1bGFyLmNpcmN1bGFyXG4gIH1cbiAgLy8gbWFpbnRhaW4gdHdvIGFycmF5cyBmb3IgY2lyY3VsYXIgcmVmZXJlbmNlcywgd2hlcmUgY29ycmVzcG9uZGluZyBwYXJlbnRzXG4gIC8vIGFuZCBjaGlsZHJlbiBoYXZlIHRoZSBzYW1lIGluZGV4XG4gIHZhciBhbGxQYXJlbnRzID0gW107XG4gIHZhciBhbGxDaGlsZHJlbiA9IFtdO1xuXG4gIHZhciB1c2VCdWZmZXIgPSB0eXBlb2YgQnVmZmVyICE9ICd1bmRlZmluZWQnO1xuXG4gIGlmICh0eXBlb2YgY2lyY3VsYXIgPT0gJ3VuZGVmaW5lZCcpXG4gICAgY2lyY3VsYXIgPSB0cnVlO1xuXG4gIGlmICh0eXBlb2YgZGVwdGggPT0gJ3VuZGVmaW5lZCcpXG4gICAgZGVwdGggPSBJbmZpbml0eTtcblxuICAvLyByZWN1cnNlIHRoaXMgZnVuY3Rpb24gc28gd2UgZG9uJ3QgcmVzZXQgYWxsUGFyZW50cyBhbmQgYWxsQ2hpbGRyZW5cbiAgZnVuY3Rpb24gX2Nsb25lKHBhcmVudCwgZGVwdGgpIHtcbiAgICAvLyBjbG9uaW5nIG51bGwgYWx3YXlzIHJldHVybnMgbnVsbFxuICAgIGlmIChwYXJlbnQgPT09IG51bGwpXG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGlmIChkZXB0aCA9PSAwKVxuICAgICAgcmV0dXJuIHBhcmVudDtcblxuICAgIHZhciBjaGlsZDtcbiAgICB2YXIgcHJvdG87XG4gICAgaWYgKHR5cGVvZiBwYXJlbnQgIT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBwYXJlbnQ7XG4gICAgfVxuXG4gICAgaWYgKGNsb25lLl9faXNBcnJheShwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IFtdO1xuICAgIH0gZWxzZSBpZiAoY2xvbmUuX19pc1JlZ0V4cChwYXJlbnQpKSB7XG4gICAgICBjaGlsZCA9IG5ldyBSZWdFeHAocGFyZW50LnNvdXJjZSwgX19nZXRSZWdFeHBGbGFncyhwYXJlbnQpKTtcbiAgICAgIGlmIChwYXJlbnQubGFzdEluZGV4KSBjaGlsZC5sYXN0SW5kZXggPSBwYXJlbnQubGFzdEluZGV4O1xuICAgIH0gZWxzZSBpZiAoY2xvbmUuX19pc0RhdGUocGFyZW50KSkge1xuICAgICAgY2hpbGQgPSBuZXcgRGF0ZShwYXJlbnQuZ2V0VGltZSgpKTtcbiAgICB9IGVsc2UgaWYgKHVzZUJ1ZmZlciAmJiBCdWZmZXIuaXNCdWZmZXIocGFyZW50KSkge1xuICAgICAgaWYgKEJ1ZmZlci5hbGxvY1Vuc2FmZSkge1xuICAgICAgICAvLyBOb2RlLmpzID49IDQuNS4wXG4gICAgICAgIGNoaWxkID0gQnVmZmVyLmFsbG9jVW5zYWZlKHBhcmVudC5sZW5ndGgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gT2xkZXIgTm9kZS5qcyB2ZXJzaW9uc1xuICAgICAgICBjaGlsZCA9IG5ldyBCdWZmZXIocGFyZW50Lmxlbmd0aCk7XG4gICAgICB9XG4gICAgICBwYXJlbnQuY29weShjaGlsZCk7XG4gICAgICByZXR1cm4gY2hpbGQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgcHJvdG90eXBlID09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gICAgICAgIGNoaWxkID0gT2JqZWN0LmNyZWF0ZShwcm90byk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2hpbGQgPSBPYmplY3QuY3JlYXRlKHByb3RvdHlwZSk7XG4gICAgICAgIHByb3RvID0gcHJvdG90eXBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaXJjdWxhcikge1xuICAgICAgdmFyIGluZGV4ID0gYWxsUGFyZW50cy5pbmRleE9mKHBhcmVudCk7XG5cbiAgICAgIGlmIChpbmRleCAhPSAtMSkge1xuICAgICAgICByZXR1cm4gYWxsQ2hpbGRyZW5baW5kZXhdO1xuICAgICAgfVxuICAgICAgYWxsUGFyZW50cy5wdXNoKHBhcmVudCk7XG4gICAgICBhbGxDaGlsZHJlbi5wdXNoKGNoaWxkKTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpIGluIHBhcmVudCkge1xuICAgICAgdmFyIGF0dHJzO1xuICAgICAgaWYgKHByb3RvKSB7XG4gICAgICAgIGF0dHJzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgaSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRycyAmJiBhdHRycy5zZXQgPT0gbnVsbCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNoaWxkW2ldID0gX2Nsb25lKHBhcmVudFtpXSwgZGVwdGggLSAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cblxuICByZXR1cm4gX2Nsb25lKHBhcmVudCwgZGVwdGgpO1xufVxuXG4vKipcbiAqIFNpbXBsZSBmbGF0IGNsb25lIHVzaW5nIHByb3RvdHlwZSwgYWNjZXB0cyBvbmx5IG9iamVjdHMsIHVzZWZ1bGwgZm9yIHByb3BlcnR5XG4gKiBvdmVycmlkZSBvbiBGTEFUIGNvbmZpZ3VyYXRpb24gb2JqZWN0IChubyBuZXN0ZWQgcHJvcHMpLlxuICpcbiAqIFVTRSBXSVRIIENBVVRJT04hIFRoaXMgbWF5IG5vdCBiZWhhdmUgYXMgeW91IHdpc2ggaWYgeW91IGRvIG5vdCBrbm93IGhvdyB0aGlzXG4gKiB3b3Jrcy5cbiAqL1xuY2xvbmUuY2xvbmVQcm90b3R5cGUgPSBmdW5jdGlvbiBjbG9uZVByb3RvdHlwZShwYXJlbnQpIHtcbiAgaWYgKHBhcmVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gbnVsbDtcblxuICB2YXIgYyA9IGZ1bmN0aW9uICgpIHt9O1xuICBjLnByb3RvdHlwZSA9IHBhcmVudDtcbiAgcmV0dXJuIG5ldyBjKCk7XG59O1xuXG4vLyBwcml2YXRlIHV0aWxpdHkgZnVuY3Rpb25zXG5cbmZ1bmN0aW9uIF9fb2JqVG9TdHIobykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pO1xufTtcbmNsb25lLl9fb2JqVG9TdHIgPSBfX29ialRvU3RyO1xuXG5mdW5jdGlvbiBfX2lzRGF0ZShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgRGF0ZV0nO1xufTtcbmNsb25lLl9faXNEYXRlID0gX19pc0RhdGU7XG5cbmZ1bmN0aW9uIF9faXNBcnJheShvKSB7XG4gIHJldHVybiB0eXBlb2YgbyA9PT0gJ29iamVjdCcgJiYgX19vYmpUb1N0cihvKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5jbG9uZS5fX2lzQXJyYXkgPSBfX2lzQXJyYXk7XG5cbmZ1bmN0aW9uIF9faXNSZWdFeHAobykge1xuICByZXR1cm4gdHlwZW9mIG8gPT09ICdvYmplY3QnICYmIF9fb2JqVG9TdHIobykgPT09ICdbb2JqZWN0IFJlZ0V4cF0nO1xufTtcbmNsb25lLl9faXNSZWdFeHAgPSBfX2lzUmVnRXhwO1xuXG5mdW5jdGlvbiBfX2dldFJlZ0V4cEZsYWdzKHJlKSB7XG4gIHZhciBmbGFncyA9ICcnO1xuICBpZiAocmUuZ2xvYmFsKSBmbGFncyArPSAnZyc7XG4gIGlmIChyZS5pZ25vcmVDYXNlKSBmbGFncyArPSAnaSc7XG4gIGlmIChyZS5tdWx0aWxpbmUpIGZsYWdzICs9ICdtJztcbiAgcmV0dXJuIGZsYWdzO1xufTtcbmNsb25lLl9fZ2V0UmVnRXhwRmxhZ3MgPSBfX2dldFJlZ0V4cEZsYWdzO1xuXG5yZXR1cm4gY2xvbmU7XG59KSgpO1xuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBjbG9uZTtcbn1cbiIsIi8vQ29weXJpZ2h0IChDKSAyMDEyIEtvcnkgTnVublxyXG5cclxuLy9QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxyXG5cclxuLy9UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cclxuXHJcbi8vVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXHJcblxyXG4vKlxyXG5cclxuICAgIFRoaXMgY29kZSBpcyBub3QgZm9ybWF0dGVkIGZvciByZWFkYWJpbGl0eSwgYnV0IHJhdGhlciBydW4tc3BlZWQgYW5kIHRvIGFzc2lzdCBjb21waWxlcnMuXHJcblxyXG4gICAgSG93ZXZlciwgdGhlIGNvZGUncyBpbnRlbnRpb24gc2hvdWxkIGJlIHRyYW5zcGFyZW50LlxyXG5cclxuICAgICoqKiBJRSBTVVBQT1JUICoqKlxyXG5cclxuICAgIElmIHlvdSByZXF1aXJlIHRoaXMgbGlicmFyeSB0byB3b3JrIGluIElFNywgYWRkIHRoZSBmb2xsb3dpbmcgYWZ0ZXIgZGVjbGFyaW5nIGNyZWwuXHJcblxyXG4gICAgdmFyIHRlc3REaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSxcclxuICAgICAgICB0ZXN0TGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdsYWJlbCcpO1xyXG5cclxuICAgIHRlc3REaXYuc2V0QXR0cmlidXRlKCdjbGFzcycsICdhJyk7XHJcbiAgICB0ZXN0RGl2WydjbGFzc05hbWUnXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWydjbGFzcyddID0gJ2NsYXNzTmFtZSc6dW5kZWZpbmVkO1xyXG4gICAgdGVzdERpdi5zZXRBdHRyaWJ1dGUoJ25hbWUnLCdhJyk7XHJcbiAgICB0ZXN0RGl2WyduYW1lJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnbmFtZSddID0gZnVuY3Rpb24oZWxlbWVudCwgdmFsdWUpe1xyXG4gICAgICAgIGVsZW1lbnQuaWQgPSB2YWx1ZTtcclxuICAgIH06dW5kZWZpbmVkO1xyXG5cclxuXHJcbiAgICB0ZXN0TGFiZWwuc2V0QXR0cmlidXRlKCdmb3InLCAnYScpO1xyXG4gICAgdGVzdExhYmVsWydodG1sRm9yJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnZm9yJ10gPSAnaHRtbEZvcic6dW5kZWZpbmVkO1xyXG5cclxuXHJcblxyXG4qL1xyXG5cclxuKGZ1bmN0aW9uIChyb290LCBmYWN0b3J5KSB7XHJcbiAgICBpZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgbW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5KCk7XHJcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xyXG4gICAgICAgIGRlZmluZShmYWN0b3J5KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcm9vdC5jcmVsID0gZmFjdG9yeSgpO1xyXG4gICAgfVxyXG59KHRoaXMsIGZ1bmN0aW9uICgpIHtcclxuICAgIHZhciBmbiA9ICdmdW5jdGlvbicsXHJcbiAgICAgICAgb2JqID0gJ29iamVjdCcsXHJcbiAgICAgICAgbm9kZVR5cGUgPSAnbm9kZVR5cGUnLFxyXG4gICAgICAgIHRleHRDb250ZW50ID0gJ3RleHRDb250ZW50JyxcclxuICAgICAgICBzZXRBdHRyaWJ1dGUgPSAnc2V0QXR0cmlidXRlJyxcclxuICAgICAgICBhdHRyTWFwU3RyaW5nID0gJ2F0dHJNYXAnLFxyXG4gICAgICAgIGlzTm9kZVN0cmluZyA9ICdpc05vZGUnLFxyXG4gICAgICAgIGlzRWxlbWVudFN0cmluZyA9ICdpc0VsZW1lbnQnLFxyXG4gICAgICAgIGQgPSB0eXBlb2YgZG9jdW1lbnQgPT09IG9iaiA/IGRvY3VtZW50IDoge30sXHJcbiAgICAgICAgaXNUeXBlID0gZnVuY3Rpb24oYSwgdHlwZSl7XHJcbiAgICAgICAgICAgIHJldHVybiB0eXBlb2YgYSA9PT0gdHlwZTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzTm9kZSA9IHR5cGVvZiBOb2RlID09PSBmbiA/IGZ1bmN0aW9uIChvYmplY3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdCBpbnN0YW5jZW9mIE5vZGU7XHJcbiAgICAgICAgfSA6XHJcbiAgICAgICAgLy8gaW4gSUUgPD0gOCBOb2RlIGlzIGFuIG9iamVjdCwgb2J2aW91c2x5Li5cclxuICAgICAgICBmdW5jdGlvbihvYmplY3Qpe1xyXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0ICYmXHJcbiAgICAgICAgICAgICAgICBpc1R5cGUob2JqZWN0LCBvYmopICYmXHJcbiAgICAgICAgICAgICAgICAobm9kZVR5cGUgaW4gb2JqZWN0KSAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdC5vd25lckRvY3VtZW50LG9iaik7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0VsZW1lbnQgPSBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBjcmVsW2lzTm9kZVN0cmluZ10ob2JqZWN0KSAmJiBvYmplY3Rbbm9kZVR5cGVdID09PSAxO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNBcnJheSA9IGZ1bmN0aW9uKGEpe1xyXG4gICAgICAgICAgICByZXR1cm4gYSBpbnN0YW5jZW9mIEFycmF5O1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYXBwZW5kQ2hpbGQgPSBmdW5jdGlvbihlbGVtZW50LCBjaGlsZCkge1xyXG4gICAgICAgICAgICBpZiAoaXNBcnJheShjaGlsZCkpIHtcclxuICAgICAgICAgICAgICAgIGNoaWxkLm1hcChmdW5jdGlvbihzdWJDaGlsZCl7XHJcbiAgICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgc3ViQ2hpbGQpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYoIWNyZWxbaXNOb2RlU3RyaW5nXShjaGlsZCkpe1xyXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBkLmNyZWF0ZVRleHROb2RlKGNoaWxkKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlbGVtZW50LmFwcGVuZENoaWxkKGNoaWxkKTtcclxuICAgICAgICB9O1xyXG5cclxuXHJcbiAgICBmdW5jdGlvbiBjcmVsKCl7XHJcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHMsIC8vTm90ZTogYXNzaWduZWQgdG8gYSB2YXJpYWJsZSB0byBhc3Npc3QgY29tcGlsZXJzLiBTYXZlcyBhYm91dCA0MCBieXRlcyBpbiBjbG9zdXJlIGNvbXBpbGVyLiBIYXMgbmVnbGlnYWJsZSBlZmZlY3Qgb24gcGVyZm9ybWFuY2UuXHJcbiAgICAgICAgICAgIGVsZW1lbnQgPSBhcmdzWzBdLFxyXG4gICAgICAgICAgICBjaGlsZCxcclxuICAgICAgICAgICAgc2V0dGluZ3MgPSBhcmdzWzFdLFxyXG4gICAgICAgICAgICBjaGlsZEluZGV4ID0gMixcclxuICAgICAgICAgICAgYXJndW1lbnRzTGVuZ3RoID0gYXJncy5sZW5ndGgsXHJcbiAgICAgICAgICAgIGF0dHJpYnV0ZU1hcCA9IGNyZWxbYXR0ck1hcFN0cmluZ107XHJcblxyXG4gICAgICAgIGVsZW1lbnQgPSBjcmVsW2lzRWxlbWVudFN0cmluZ10oZWxlbWVudCkgPyBlbGVtZW50IDogZC5jcmVhdGVFbGVtZW50KGVsZW1lbnQpO1xyXG4gICAgICAgIC8vIHNob3J0Y3V0XHJcbiAgICAgICAgaWYoYXJndW1lbnRzTGVuZ3RoID09PSAxKXtcclxuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZighaXNUeXBlKHNldHRpbmdzLG9iaikgfHwgY3JlbFtpc05vZGVTdHJpbmddKHNldHRpbmdzKSB8fCBpc0FycmF5KHNldHRpbmdzKSkge1xyXG4gICAgICAgICAgICAtLWNoaWxkSW5kZXg7XHJcbiAgICAgICAgICAgIHNldHRpbmdzID0gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIHNob3J0Y3V0IGlmIHRoZXJlIGlzIG9ubHkgb25lIGNoaWxkIHRoYXQgaXMgYSBzdHJpbmdcclxuICAgICAgICBpZigoYXJndW1lbnRzTGVuZ3RoIC0gY2hpbGRJbmRleCkgPT09IDEgJiYgaXNUeXBlKGFyZ3NbY2hpbGRJbmRleF0sICdzdHJpbmcnKSAmJiBlbGVtZW50W3RleHRDb250ZW50XSAhPT0gdW5kZWZpbmVkKXtcclxuICAgICAgICAgICAgZWxlbWVudFt0ZXh0Q29udGVudF0gPSBhcmdzW2NoaWxkSW5kZXhdO1xyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICBmb3IoOyBjaGlsZEluZGV4IDwgYXJndW1lbnRzTGVuZ3RoOyArK2NoaWxkSW5kZXgpe1xyXG4gICAgICAgICAgICAgICAgY2hpbGQgPSBhcmdzW2NoaWxkSW5kZXhdO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmKGNoaWxkID09IG51bGwpe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmIChpc0FycmF5KGNoaWxkKSkge1xyXG4gICAgICAgICAgICAgICAgICBmb3IgKHZhciBpPTA7IGkgPCBjaGlsZC5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIGNoaWxkW2ldKTtcclxuICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgY2hpbGQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XHJcbiAgICAgICAgICAgIGlmKCFhdHRyaWJ1dGVNYXBba2V5XSl7XHJcbiAgICAgICAgICAgICAgICBpZihpc1R5cGUoc2V0dGluZ3Nba2V5XSxmbikpe1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnRba2V5XSA9IHNldHRpbmdzW2tleV07XHJcbiAgICAgICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgICAgICBlbGVtZW50W3NldEF0dHJpYnV0ZV0oa2V5LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgICAgICB2YXIgYXR0ciA9IGF0dHJpYnV0ZU1hcFtrZXldO1xyXG4gICAgICAgICAgICAgICAgaWYodHlwZW9mIGF0dHIgPT09IGZuKXtcclxuICAgICAgICAgICAgICAgICAgICBhdHRyKGVsZW1lbnQsIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudFtzZXRBdHRyaWJ1dGVdKGF0dHIsIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBVc2VkIGZvciBtYXBwaW5nIG9uZSBraW5kIG9mIGF0dHJpYnV0ZSB0byB0aGUgc3VwcG9ydGVkIHZlcnNpb24gb2YgdGhhdCBpbiBiYWQgYnJvd3NlcnMuXHJcbiAgICBjcmVsW2F0dHJNYXBTdHJpbmddID0ge307XHJcblxyXG4gICAgY3JlbFtpc0VsZW1lbnRTdHJpbmddID0gaXNFbGVtZW50O1xyXG5cclxuICAgIGNyZWxbaXNOb2RlU3RyaW5nXSA9IGlzTm9kZTtcclxuXHJcbiAgICBpZih0eXBlb2YgUHJveHkgIT09ICd1bmRlZmluZWQnKXtcclxuICAgICAgICBjcmVsLnByb3h5ID0gbmV3IFByb3h5KGNyZWwsIHtcclxuICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbih0YXJnZXQsIGtleSl7XHJcbiAgICAgICAgICAgICAgICAhKGtleSBpbiBjcmVsKSAmJiAoY3JlbFtrZXldID0gY3JlbC5iaW5kKG51bGwsIGtleSkpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGNyZWxba2V5XTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBjcmVsO1xyXG59KSk7XHJcbiIsImZ1bmN0aW9uIGNvbXBhcmUoYSwgYiwgdmlzaXRlZCl7XG4gICAgdmFyIGFUeXBlID0gdHlwZW9mIGE7XG5cbiAgICBpZihhVHlwZSAhPT0gdHlwZW9mIGIpe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgaWYoYSA9PSBudWxsIHx8IGIgPT0gbnVsbCB8fCAhKGFUeXBlID09PSAnb2JqZWN0JyB8fCBhVHlwZSA9PT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICBpZihhVHlwZSA9PT0gJ251bWJlcicgJiYgaXNOYU4oYSkgJiYgaXNOYU4oYikpe1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYSA9PT0gYjtcbiAgICB9XG5cbiAgICBpZihBcnJheS5pc0FycmF5KGEpICE9PSBBcnJheS5pc0FycmF5KGIpKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHZhciBhS2V5cyA9IE9iamVjdC5rZXlzKGEpLFxuICAgICAgICBiS2V5cyA9IE9iamVjdC5rZXlzKGIpO1xuXG4gICAgaWYoYUtleXMubGVuZ3RoICE9PSBiS2V5cy5sZW5ndGgpe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgdmFyIGVxdWFsID0gdHJ1ZTtcblxuICAgIGlmKCF2aXNpdGVkKXtcbiAgICAgICAgdmlzaXRlZCA9IG5ldyBTZXQoKTtcbiAgICB9XG5cbiAgICBhS2V5cy5mb3JFYWNoKGZ1bmN0aW9uKGtleSl7XG4gICAgICAgIGlmKCEoa2V5IGluIGIpKXtcbiAgICAgICAgICAgIGVxdWFsID0gZmFsc2U7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYoYVtrZXldICYmIGFba2V5XSBpbnN0YW5jZW9mIE9iamVjdCl7XG4gICAgICAgICAgICBpZih2aXNpdGVkLmhhcyhhW2tleV0pKXtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2aXNpdGVkLmFkZChhW2tleV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFjb21wYXJlKGFba2V5XSwgYltrZXldLCB2aXNpdGVkKSl7XG4gICAgICAgICAgICBlcXVhbCA9IGZhbHNlO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gZXF1YWw7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGEsIGIpe1xuICAgIHJldHVybiBjb21wYXJlKGEsIGIpO1xufSIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG52YXIgb2JqZWN0Q3JlYXRlID0gT2JqZWN0LmNyZWF0ZSB8fCBvYmplY3RDcmVhdGVQb2x5ZmlsbFxudmFyIG9iamVjdEtleXMgPSBPYmplY3Qua2V5cyB8fCBvYmplY3RLZXlzUG9seWZpbGxcbnZhciBiaW5kID0gRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQgfHwgZnVuY3Rpb25CaW5kUG9seWZpbGxcblxuZnVuY3Rpb24gRXZlbnRFbWl0dGVyKCkge1xuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsICdfZXZlbnRzJykpIHtcbiAgICB0aGlzLl9ldmVudHMgPSBvYmplY3RDcmVhdGUobnVsbCk7XG4gICAgdGhpcy5fZXZlbnRzQ291bnQgPSAwO1xuICB9XG5cbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gdGhpcy5fbWF4TGlzdGVuZXJzIHx8IHVuZGVmaW5lZDtcbn1cbm1vZHVsZS5leHBvcnRzID0gRXZlbnRFbWl0dGVyO1xuXG4vLyBCYWNrd2FyZHMtY29tcGF0IHdpdGggbm9kZSAwLjEwLnhcbkV2ZW50RW1pdHRlci5FdmVudEVtaXR0ZXIgPSBFdmVudEVtaXR0ZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX2V2ZW50cyA9IHVuZGVmaW5lZDtcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX21heExpc3RlbmVycyA9IHVuZGVmaW5lZDtcblxuLy8gQnkgZGVmYXVsdCBFdmVudEVtaXR0ZXJzIHdpbGwgcHJpbnQgYSB3YXJuaW5nIGlmIG1vcmUgdGhhbiAxMCBsaXN0ZW5lcnMgYXJlXG4vLyBhZGRlZCB0byBpdC4gVGhpcyBpcyBhIHVzZWZ1bCBkZWZhdWx0IHdoaWNoIGhlbHBzIGZpbmRpbmcgbWVtb3J5IGxlYWtzLlxudmFyIGRlZmF1bHRNYXhMaXN0ZW5lcnMgPSAxMDtcblxudmFyIGhhc0RlZmluZVByb3BlcnR5O1xudHJ5IHtcbiAgdmFyIG8gPSB7fTtcbiAgaWYgKE9iamVjdC5kZWZpbmVQcm9wZXJ0eSkgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sICd4JywgeyB2YWx1ZTogMCB9KTtcbiAgaGFzRGVmaW5lUHJvcGVydHkgPSBvLnggPT09IDA7XG59IGNhdGNoIChlcnIpIHsgaGFzRGVmaW5lUHJvcGVydHkgPSBmYWxzZSB9XG5pZiAoaGFzRGVmaW5lUHJvcGVydHkpIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KEV2ZW50RW1pdHRlciwgJ2RlZmF1bHRNYXhMaXN0ZW5lcnMnLCB7XG4gICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGRlZmF1bHRNYXhMaXN0ZW5lcnM7XG4gICAgfSxcbiAgICBzZXQ6IGZ1bmN0aW9uKGFyZykge1xuICAgICAgLy8gY2hlY2sgd2hldGhlciB0aGUgaW5wdXQgaXMgYSBwb3NpdGl2ZSBudW1iZXIgKHdob3NlIHZhbHVlIGlzIHplcm8gb3JcbiAgICAgIC8vIGdyZWF0ZXIgYW5kIG5vdCBhIE5hTikuXG4gICAgICBpZiAodHlwZW9mIGFyZyAhPT0gJ251bWJlcicgfHwgYXJnIDwgMCB8fCBhcmcgIT09IGFyZylcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJkZWZhdWx0TWF4TGlzdGVuZXJzXCIgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpO1xuICAgICAgZGVmYXVsdE1heExpc3RlbmVycyA9IGFyZztcbiAgICB9XG4gIH0pO1xufSBlbHNlIHtcbiAgRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnMgPSBkZWZhdWx0TWF4TGlzdGVuZXJzO1xufVxuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbiBzZXRNYXhMaXN0ZW5lcnMobikge1xuICBpZiAodHlwZW9mIG4gIT09ICdudW1iZXInIHx8IG4gPCAwIHx8IGlzTmFOKG4pKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wiblwiIGFyZ3VtZW50IG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5mdW5jdGlvbiAkZ2V0TWF4TGlzdGVuZXJzKHRoYXQpIHtcbiAgaWYgKHRoYXQuX21heExpc3RlbmVycyA9PT0gdW5kZWZpbmVkKVxuICAgIHJldHVybiBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycztcbiAgcmV0dXJuIHRoYXQuX21heExpc3RlbmVycztcbn1cblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5nZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbiBnZXRNYXhMaXN0ZW5lcnMoKSB7XG4gIHJldHVybiAkZ2V0TWF4TGlzdGVuZXJzKHRoaXMpO1xufTtcblxuLy8gVGhlc2Ugc3RhbmRhbG9uZSBlbWl0KiBmdW5jdGlvbnMgYXJlIHVzZWQgdG8gb3B0aW1pemUgY2FsbGluZyBvZiBldmVudFxuLy8gaGFuZGxlcnMgZm9yIGZhc3QgY2FzZXMgYmVjYXVzZSBlbWl0KCkgaXRzZWxmIG9mdGVuIGhhcyBhIHZhcmlhYmxlIG51bWJlciBvZlxuLy8gYXJndW1lbnRzIGFuZCBjYW4gYmUgZGVvcHRpbWl6ZWQgYmVjYXVzZSBvZiB0aGF0LiBUaGVzZSBmdW5jdGlvbnMgYWx3YXlzIGhhdmVcbi8vIHRoZSBzYW1lIG51bWJlciBvZiBhcmd1bWVudHMgYW5kIHRodXMgZG8gbm90IGdldCBkZW9wdGltaXplZCwgc28gdGhlIGNvZGVcbi8vIGluc2lkZSB0aGVtIGNhbiBleGVjdXRlIGZhc3Rlci5cbmZ1bmN0aW9uIGVtaXROb25lKGhhbmRsZXIsIGlzRm4sIHNlbGYpIHtcbiAgaWYgKGlzRm4pXG4gICAgaGFuZGxlci5jYWxsKHNlbGYpO1xuICBlbHNlIHtcbiAgICB2YXIgbGVuID0gaGFuZGxlci5sZW5ndGg7XG4gICAgdmFyIGxpc3RlbmVycyA9IGFycmF5Q2xvbmUoaGFuZGxlciwgbGVuKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgKytpKVxuICAgICAgbGlzdGVuZXJzW2ldLmNhbGwoc2VsZik7XG4gIH1cbn1cbmZ1bmN0aW9uIGVtaXRPbmUoaGFuZGxlciwgaXNGbiwgc2VsZiwgYXJnMSkge1xuICBpZiAoaXNGbilcbiAgICBoYW5kbGVyLmNhbGwoc2VsZiwgYXJnMSk7XG4gIGVsc2Uge1xuICAgIHZhciBsZW4gPSBoYW5kbGVyLmxlbmd0aDtcbiAgICB2YXIgbGlzdGVuZXJzID0gYXJyYXlDbG9uZShoYW5kbGVyLCBsZW4pO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpXG4gICAgICBsaXN0ZW5lcnNbaV0uY2FsbChzZWxmLCBhcmcxKTtcbiAgfVxufVxuZnVuY3Rpb24gZW1pdFR3byhoYW5kbGVyLCBpc0ZuLCBzZWxmLCBhcmcxLCBhcmcyKSB7XG4gIGlmIChpc0ZuKVxuICAgIGhhbmRsZXIuY2FsbChzZWxmLCBhcmcxLCBhcmcyKTtcbiAgZWxzZSB7XG4gICAgdmFyIGxlbiA9IGhhbmRsZXIubGVuZ3RoO1xuICAgIHZhciBsaXN0ZW5lcnMgPSBhcnJheUNsb25lKGhhbmRsZXIsIGxlbik7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSlcbiAgICAgIGxpc3RlbmVyc1tpXS5jYWxsKHNlbGYsIGFyZzEsIGFyZzIpO1xuICB9XG59XG5mdW5jdGlvbiBlbWl0VGhyZWUoaGFuZGxlciwgaXNGbiwgc2VsZiwgYXJnMSwgYXJnMiwgYXJnMykge1xuICBpZiAoaXNGbilcbiAgICBoYW5kbGVyLmNhbGwoc2VsZiwgYXJnMSwgYXJnMiwgYXJnMyk7XG4gIGVsc2Uge1xuICAgIHZhciBsZW4gPSBoYW5kbGVyLmxlbmd0aDtcbiAgICB2YXIgbGlzdGVuZXJzID0gYXJyYXlDbG9uZShoYW5kbGVyLCBsZW4pO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpXG4gICAgICBsaXN0ZW5lcnNbaV0uY2FsbChzZWxmLCBhcmcxLCBhcmcyLCBhcmczKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBlbWl0TWFueShoYW5kbGVyLCBpc0ZuLCBzZWxmLCBhcmdzKSB7XG4gIGlmIChpc0ZuKVxuICAgIGhhbmRsZXIuYXBwbHkoc2VsZiwgYXJncyk7XG4gIGVsc2Uge1xuICAgIHZhciBsZW4gPSBoYW5kbGVyLmxlbmd0aDtcbiAgICB2YXIgbGlzdGVuZXJzID0gYXJyYXlDbG9uZShoYW5kbGVyLCBsZW4pO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpXG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkoc2VsZiwgYXJncyk7XG4gIH1cbn1cblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24gZW1pdCh0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBldmVudHM7XG4gIHZhciBkb0Vycm9yID0gKHR5cGUgPT09ICdlcnJvcicpO1xuXG4gIGV2ZW50cyA9IHRoaXMuX2V2ZW50cztcbiAgaWYgKGV2ZW50cylcbiAgICBkb0Vycm9yID0gKGRvRXJyb3IgJiYgZXZlbnRzLmVycm9yID09IG51bGwpO1xuICBlbHNlIGlmICghZG9FcnJvcilcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAoZG9FcnJvcikge1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSlcbiAgICAgIGVyID0gYXJndW1lbnRzWzFdO1xuICAgIGlmIChlciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQXQgbGVhc3QgZ2l2ZSBzb21lIGtpbmQgb2YgY29udGV4dCB0byB0aGUgdXNlclxuICAgICAgdmFyIGVyciA9IG5ldyBFcnJvcignVW5oYW5kbGVkIFwiZXJyb3JcIiBldmVudC4gKCcgKyBlciArICcpJyk7XG4gICAgICBlcnIuY29udGV4dCA9IGVyO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBoYW5kbGVyID0gZXZlbnRzW3R5cGVdO1xuXG4gIGlmICghaGFuZGxlcilcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIGlzRm4gPSB0eXBlb2YgaGFuZGxlciA9PT0gJ2Z1bmN0aW9uJztcbiAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgc3dpdGNoIChsZW4pIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICBjYXNlIDE6XG4gICAgICBlbWl0Tm9uZShoYW5kbGVyLCBpc0ZuLCB0aGlzKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMjpcbiAgICAgIGVtaXRPbmUoaGFuZGxlciwgaXNGbiwgdGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgMzpcbiAgICAgIGVtaXRUd28oaGFuZGxlciwgaXNGbiwgdGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSA0OlxuICAgICAgZW1pdFRocmVlKGhhbmRsZXIsIGlzRm4sIHRoaXMsIGFyZ3VtZW50c1sxXSwgYXJndW1lbnRzWzJdLCBhcmd1bWVudHNbM10pO1xuICAgICAgYnJlYWs7XG4gICAgICAvLyBzbG93ZXJcbiAgICBkZWZhdWx0OlxuICAgICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICAgIGZvciAoaSA9IDE7IGkgPCBsZW47IGkrKylcbiAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICBlbWl0TWFueShoYW5kbGVyLCBpc0ZuLCB0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuZnVuY3Rpb24gX2FkZExpc3RlbmVyKHRhcmdldCwgdHlwZSwgbGlzdGVuZXIsIHByZXBlbmQpIHtcbiAgdmFyIG07XG4gIHZhciBldmVudHM7XG4gIHZhciBleGlzdGluZztcblxuICBpZiAodHlwZW9mIGxpc3RlbmVyICE9PSAnZnVuY3Rpb24nKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wibGlzdGVuZXJcIiBhcmd1bWVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBldmVudHMgPSB0YXJnZXQuX2V2ZW50cztcbiAgaWYgKCFldmVudHMpIHtcbiAgICBldmVudHMgPSB0YXJnZXQuX2V2ZW50cyA9IG9iamVjdENyZWF0ZShudWxsKTtcbiAgICB0YXJnZXQuX2V2ZW50c0NvdW50ID0gMDtcbiAgfSBlbHNlIHtcbiAgICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAgIC8vIGFkZGluZyBpdCB0byB0aGUgbGlzdGVuZXJzLCBmaXJzdCBlbWl0IFwibmV3TGlzdGVuZXJcIi5cbiAgICBpZiAoZXZlbnRzLm5ld0xpc3RlbmVyKSB7XG4gICAgICB0YXJnZXQuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLFxuICAgICAgICAgIGxpc3RlbmVyLmxpc3RlbmVyID8gbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgICAgIC8vIFJlLWFzc2lnbiBgZXZlbnRzYCBiZWNhdXNlIGEgbmV3TGlzdGVuZXIgaGFuZGxlciBjb3VsZCBoYXZlIGNhdXNlZCB0aGVcbiAgICAgIC8vIHRoaXMuX2V2ZW50cyB0byBiZSBhc3NpZ25lZCB0byBhIG5ldyBvYmplY3RcbiAgICAgIGV2ZW50cyA9IHRhcmdldC5fZXZlbnRzO1xuICAgIH1cbiAgICBleGlzdGluZyA9IGV2ZW50c1t0eXBlXTtcbiAgfVxuXG4gIGlmICghZXhpc3RpbmcpIHtcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICBleGlzdGluZyA9IGV2ZW50c1t0eXBlXSA9IGxpc3RlbmVyO1xuICAgICsrdGFyZ2V0Ll9ldmVudHNDb3VudDtcbiAgfSBlbHNlIHtcbiAgICBpZiAodHlwZW9mIGV4aXN0aW5nID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICAgIGV4aXN0aW5nID0gZXZlbnRzW3R5cGVdID1cbiAgICAgICAgICBwcmVwZW5kID8gW2xpc3RlbmVyLCBleGlzdGluZ10gOiBbZXhpc3RpbmcsIGxpc3RlbmVyXTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgICAgaWYgKHByZXBlbmQpIHtcbiAgICAgICAgZXhpc3RpbmcudW5zaGlmdChsaXN0ZW5lcik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleGlzdGluZy5wdXNoKGxpc3RlbmVyKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICAgIGlmICghZXhpc3Rpbmcud2FybmVkKSB7XG4gICAgICBtID0gJGdldE1heExpc3RlbmVycyh0YXJnZXQpO1xuICAgICAgaWYgKG0gJiYgbSA+IDAgJiYgZXhpc3RpbmcubGVuZ3RoID4gbSkge1xuICAgICAgICBleGlzdGluZy53YXJuZWQgPSB0cnVlO1xuICAgICAgICB2YXIgdyA9IG5ldyBFcnJvcignUG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSBsZWFrIGRldGVjdGVkLiAnICtcbiAgICAgICAgICAgIGV4aXN0aW5nLmxlbmd0aCArICcgXCInICsgU3RyaW5nKHR5cGUpICsgJ1wiIGxpc3RlbmVycyAnICtcbiAgICAgICAgICAgICdhZGRlZC4gVXNlIGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKCkgdG8gJyArXG4gICAgICAgICAgICAnaW5jcmVhc2UgbGltaXQuJyk7XG4gICAgICAgIHcubmFtZSA9ICdNYXhMaXN0ZW5lcnNFeGNlZWRlZFdhcm5pbmcnO1xuICAgICAgICB3LmVtaXR0ZXIgPSB0YXJnZXQ7XG4gICAgICAgIHcudHlwZSA9IHR5cGU7XG4gICAgICAgIHcuY291bnQgPSBleGlzdGluZy5sZW5ndGg7XG4gICAgICAgIGlmICh0eXBlb2YgY29uc29sZSA9PT0gJ29iamVjdCcgJiYgY29uc29sZS53YXJuKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKCclczogJXMnLCB3Lm5hbWUsIHcubWVzc2FnZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0O1xufVxuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24gYWRkTGlzdGVuZXIodHlwZSwgbGlzdGVuZXIpIHtcbiAgcmV0dXJuIF9hZGRMaXN0ZW5lcih0aGlzLCB0eXBlLCBsaXN0ZW5lciwgZmFsc2UpO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucHJlcGVuZExpc3RlbmVyID1cbiAgICBmdW5jdGlvbiBwcmVwZW5kTGlzdGVuZXIodHlwZSwgbGlzdGVuZXIpIHtcbiAgICAgIHJldHVybiBfYWRkTGlzdGVuZXIodGhpcywgdHlwZSwgbGlzdGVuZXIsIHRydWUpO1xuICAgIH07XG5cbmZ1bmN0aW9uIG9uY2VXcmFwcGVyKCkge1xuICBpZiAoIXRoaXMuZmlyZWQpIHtcbiAgICB0aGlzLnRhcmdldC5yZW1vdmVMaXN0ZW5lcih0aGlzLnR5cGUsIHRoaXMud3JhcEZuKTtcbiAgICB0aGlzLmZpcmVkID0gdHJ1ZTtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMDpcbiAgICAgICAgcmV0dXJuIHRoaXMubGlzdGVuZXIuY2FsbCh0aGlzLnRhcmdldCk7XG4gICAgICBjYXNlIDE6XG4gICAgICAgIHJldHVybiB0aGlzLmxpc3RlbmVyLmNhbGwodGhpcy50YXJnZXQsIGFyZ3VtZW50c1swXSk7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIHJldHVybiB0aGlzLmxpc3RlbmVyLmNhbGwodGhpcy50YXJnZXQsIGFyZ3VtZW50c1swXSwgYXJndW1lbnRzWzFdKTtcbiAgICAgIGNhc2UgMzpcbiAgICAgICAgcmV0dXJuIHRoaXMubGlzdGVuZXIuY2FsbCh0aGlzLnRhcmdldCwgYXJndW1lbnRzWzBdLCBhcmd1bWVudHNbMV0sXG4gICAgICAgICAgICBhcmd1bWVudHNbMl0pO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7ICsraSlcbiAgICAgICAgICBhcmdzW2ldID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB0aGlzLmxpc3RlbmVyLmFwcGx5KHRoaXMudGFyZ2V0LCBhcmdzKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gX29uY2VXcmFwKHRhcmdldCwgdHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIHN0YXRlID0geyBmaXJlZDogZmFsc2UsIHdyYXBGbjogdW5kZWZpbmVkLCB0YXJnZXQ6IHRhcmdldCwgdHlwZTogdHlwZSwgbGlzdGVuZXI6IGxpc3RlbmVyIH07XG4gIHZhciB3cmFwcGVkID0gYmluZC5jYWxsKG9uY2VXcmFwcGVyLCBzdGF0ZSk7XG4gIHdyYXBwZWQubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgc3RhdGUud3JhcEZuID0gd3JhcHBlZDtcbiAgcmV0dXJuIHdyYXBwZWQ7XG59XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uIG9uY2UodHlwZSwgbGlzdGVuZXIpIHtcbiAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJylcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcImxpc3RlbmVyXCIgYXJndW1lbnQgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIHRoaXMub24odHlwZSwgX29uY2VXcmFwKHRoaXMsIHR5cGUsIGxpc3RlbmVyKSk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5wcmVwZW5kT25jZUxpc3RlbmVyID1cbiAgICBmdW5jdGlvbiBwcmVwZW5kT25jZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVyKSB7XG4gICAgICBpZiAodHlwZW9mIGxpc3RlbmVyICE9PSAnZnVuY3Rpb24nKVxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcImxpc3RlbmVyXCIgYXJndW1lbnQgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgICB0aGlzLnByZXBlbmRMaXN0ZW5lcih0eXBlLCBfb25jZVdyYXAodGhpcywgdHlwZSwgbGlzdGVuZXIpKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbi8vIEVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZiBhbmQgb25seSBpZiB0aGUgbGlzdGVuZXIgd2FzIHJlbW92ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID1cbiAgICBmdW5jdGlvbiByZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcikge1xuICAgICAgdmFyIGxpc3QsIGV2ZW50cywgcG9zaXRpb24sIGksIG9yaWdpbmFsTGlzdGVuZXI7XG5cbiAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wibGlzdGVuZXJcIiBhcmd1bWVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICAgICAgZXZlbnRzID0gdGhpcy5fZXZlbnRzO1xuICAgICAgaWYgKCFldmVudHMpXG4gICAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgICBsaXN0ID0gZXZlbnRzW3R5cGVdO1xuICAgICAgaWYgKCFsaXN0KVxuICAgICAgICByZXR1cm4gdGhpcztcblxuICAgICAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8IGxpc3QubGlzdGVuZXIgPT09IGxpc3RlbmVyKSB7XG4gICAgICAgIGlmICgtLXRoaXMuX2V2ZW50c0NvdW50ID09PSAwKVxuICAgICAgICAgIHRoaXMuX2V2ZW50cyA9IG9iamVjdENyZWF0ZShudWxsKTtcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgZGVsZXRlIGV2ZW50c1t0eXBlXTtcbiAgICAgICAgICBpZiAoZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3QubGlzdGVuZXIgfHwgbGlzdGVuZXIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBsaXN0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHBvc2l0aW9uID0gLTE7XG5cbiAgICAgICAgZm9yIChpID0gbGlzdC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICAgIGlmIChsaXN0W2ldID09PSBsaXN0ZW5lciB8fCBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikge1xuICAgICAgICAgICAgb3JpZ2luYWxMaXN0ZW5lciA9IGxpc3RbaV0ubGlzdGVuZXI7XG4gICAgICAgICAgICBwb3NpdGlvbiA9IGk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgICAgIGlmIChwb3NpdGlvbiA9PT0gMClcbiAgICAgICAgICBsaXN0LnNoaWZ0KCk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICBzcGxpY2VPbmUobGlzdCwgcG9zaXRpb24pO1xuXG4gICAgICAgIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSlcbiAgICAgICAgICBldmVudHNbdHlwZV0gPSBsaXN0WzBdO1xuXG4gICAgICAgIGlmIChldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIG9yaWdpbmFsTGlzdGVuZXIgfHwgbGlzdGVuZXIpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9XG4gICAgZnVuY3Rpb24gcmVtb3ZlQWxsTGlzdGVuZXJzKHR5cGUpIHtcbiAgICAgIHZhciBsaXN0ZW5lcnMsIGV2ZW50cywgaTtcblxuICAgICAgZXZlbnRzID0gdGhpcy5fZXZlbnRzO1xuICAgICAgaWYgKCFldmVudHMpXG4gICAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gICAgICBpZiAoIWV2ZW50cy5yZW1vdmVMaXN0ZW5lcikge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHRoaXMuX2V2ZW50cyA9IG9iamVjdENyZWF0ZShudWxsKTtcbiAgICAgICAgICB0aGlzLl9ldmVudHNDb3VudCA9IDA7XG4gICAgICAgIH0gZWxzZSBpZiAoZXZlbnRzW3R5cGVdKSB7XG4gICAgICAgICAgaWYgKC0tdGhpcy5fZXZlbnRzQ291bnQgPT09IDApXG4gICAgICAgICAgICB0aGlzLl9ldmVudHMgPSBvYmplY3RDcmVhdGUobnVsbCk7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgZGVsZXRlIGV2ZW50c1t0eXBlXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cblxuICAgICAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB2YXIga2V5cyA9IG9iamVjdEtleXMoZXZlbnRzKTtcbiAgICAgICAgdmFyIGtleTtcbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGtleXMubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgICBrZXkgPSBrZXlzW2ldO1xuICAgICAgICAgIGlmIChrZXkgPT09ICdyZW1vdmVMaXN0ZW5lcicpIGNvbnRpbnVlO1xuICAgICAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3JlbW92ZUxpc3RlbmVyJyk7XG4gICAgICAgIHRoaXMuX2V2ZW50cyA9IG9iamVjdENyZWF0ZShudWxsKTtcbiAgICAgICAgdGhpcy5fZXZlbnRzQ291bnQgPSAwO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cblxuICAgICAgbGlzdGVuZXJzID0gZXZlbnRzW3R5cGVdO1xuXG4gICAgICBpZiAodHlwZW9mIGxpc3RlbmVycyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gICAgICB9IGVsc2UgaWYgKGxpc3RlbmVycykge1xuICAgICAgICAvLyBMSUZPIG9yZGVyXG4gICAgICAgIGZvciAoaSA9IGxpc3RlbmVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzW2ldKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9O1xuXG5mdW5jdGlvbiBfbGlzdGVuZXJzKHRhcmdldCwgdHlwZSwgdW53cmFwKSB7XG4gIHZhciBldmVudHMgPSB0YXJnZXQuX2V2ZW50cztcblxuICBpZiAoIWV2ZW50cylcbiAgICByZXR1cm4gW107XG5cbiAgdmFyIGV2bGlzdGVuZXIgPSBldmVudHNbdHlwZV07XG4gIGlmICghZXZsaXN0ZW5lcilcbiAgICByZXR1cm4gW107XG5cbiAgaWYgKHR5cGVvZiBldmxpc3RlbmVyID09PSAnZnVuY3Rpb24nKVxuICAgIHJldHVybiB1bndyYXAgPyBbZXZsaXN0ZW5lci5saXN0ZW5lciB8fCBldmxpc3RlbmVyXSA6IFtldmxpc3RlbmVyXTtcblxuICByZXR1cm4gdW53cmFwID8gdW53cmFwTGlzdGVuZXJzKGV2bGlzdGVuZXIpIDogYXJyYXlDbG9uZShldmxpc3RlbmVyLCBldmxpc3RlbmVyLmxlbmd0aCk7XG59XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24gbGlzdGVuZXJzKHR5cGUpIHtcbiAgcmV0dXJuIF9saXN0ZW5lcnModGhpcywgdHlwZSwgdHJ1ZSk7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJhd0xpc3RlbmVycyA9IGZ1bmN0aW9uIHJhd0xpc3RlbmVycyh0eXBlKSB7XG4gIHJldHVybiBfbGlzdGVuZXJzKHRoaXMsIHR5cGUsIGZhbHNlKTtcbn07XG5cbkV2ZW50RW1pdHRlci5saXN0ZW5lckNvdW50ID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSkge1xuICBpZiAodHlwZW9mIGVtaXR0ZXIubGlzdGVuZXJDb3VudCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBlbWl0dGVyLmxpc3RlbmVyQ291bnQodHlwZSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGxpc3RlbmVyQ291bnQuY2FsbChlbWl0dGVyLCB0eXBlKTtcbiAgfVxufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lckNvdW50ID0gbGlzdGVuZXJDb3VudDtcbmZ1bmN0aW9uIGxpc3RlbmVyQ291bnQodHlwZSkge1xuICB2YXIgZXZlbnRzID0gdGhpcy5fZXZlbnRzO1xuXG4gIGlmIChldmVudHMpIHtcbiAgICB2YXIgZXZsaXN0ZW5lciA9IGV2ZW50c1t0eXBlXTtcblxuICAgIGlmICh0eXBlb2YgZXZsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIDE7XG4gICAgfSBlbHNlIGlmIChldmxpc3RlbmVyKSB7XG4gICAgICByZXR1cm4gZXZsaXN0ZW5lci5sZW5ndGg7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIDA7XG59XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuZXZlbnROYW1lcyA9IGZ1bmN0aW9uIGV2ZW50TmFtZXMoKSB7XG4gIHJldHVybiB0aGlzLl9ldmVudHNDb3VudCA+IDAgPyBSZWZsZWN0Lm93bktleXModGhpcy5fZXZlbnRzKSA6IFtdO1xufTtcblxuLy8gQWJvdXQgMS41eCBmYXN0ZXIgdGhhbiB0aGUgdHdvLWFyZyB2ZXJzaW9uIG9mIEFycmF5I3NwbGljZSgpLlxuZnVuY3Rpb24gc3BsaWNlT25lKGxpc3QsIGluZGV4KSB7XG4gIGZvciAodmFyIGkgPSBpbmRleCwgayA9IGkgKyAxLCBuID0gbGlzdC5sZW5ndGg7IGsgPCBuOyBpICs9IDEsIGsgKz0gMSlcbiAgICBsaXN0W2ldID0gbGlzdFtrXTtcbiAgbGlzdC5wb3AoKTtcbn1cblxuZnVuY3Rpb24gYXJyYXlDbG9uZShhcnIsIG4pIHtcbiAgdmFyIGNvcHkgPSBuZXcgQXJyYXkobik7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbjsgKytpKVxuICAgIGNvcHlbaV0gPSBhcnJbaV07XG4gIHJldHVybiBjb3B5O1xufVxuXG5mdW5jdGlvbiB1bndyYXBMaXN0ZW5lcnMoYXJyKSB7XG4gIHZhciByZXQgPSBuZXcgQXJyYXkoYXJyLmxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcmV0Lmxlbmd0aDsgKytpKSB7XG4gICAgcmV0W2ldID0gYXJyW2ldLmxpc3RlbmVyIHx8IGFycltpXTtcbiAgfVxuICByZXR1cm4gcmV0O1xufVxuXG5mdW5jdGlvbiBvYmplY3RDcmVhdGVQb2x5ZmlsbChwcm90bykge1xuICB2YXIgRiA9IGZ1bmN0aW9uKCkge307XG4gIEYucHJvdG90eXBlID0gcHJvdG87XG4gIHJldHVybiBuZXcgRjtcbn1cbmZ1bmN0aW9uIG9iamVjdEtleXNQb2x5ZmlsbChvYmopIHtcbiAgdmFyIGtleXMgPSBbXTtcbiAgZm9yICh2YXIgayBpbiBvYmopIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBrKSkge1xuICAgIGtleXMucHVzaChrKTtcbiAgfVxuICByZXR1cm4gaztcbn1cbmZ1bmN0aW9uIGZ1bmN0aW9uQmluZFBvbHlmaWxsKGNvbnRleHQpIHtcbiAgdmFyIGZuID0gdGhpcztcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gZm4uYXBwbHkoY29udGV4dCwgYXJndW1lbnRzKTtcbiAgfTtcbn1cbiIsInZhciBpcyA9IHJlcXVpcmUoJy4vaXMnKSxcbiAgICBHRU5FUklDID0gJ19nZW5lcmljJyxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXIsXG4gICAgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5cbmZ1bmN0aW9uIGZsYXR0ZW4oaXRlbSl7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoaXRlbSkgPyBpdGVtLnJlZHVjZShmdW5jdGlvbihyZXN1bHQsIGVsZW1lbnQpe1xuICAgICAgICBpZihlbGVtZW50ID09IG51bGwpe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0LmNvbmNhdChmbGF0dGVuKGVsZW1lbnQpKTtcbiAgICB9LFtdKSA6IGl0ZW07XG59XG5cbmZ1bmN0aW9uIGF0dGFjaFByb3BlcnRpZXMob2JqZWN0LCBmaXJtKXtcbiAgICBmb3IodmFyIGtleSBpbiB0aGlzLl9wcm9wZXJ0aWVzKXtcbiAgICAgICAgdGhpcy5fcHJvcGVydGllc1trZXldLmF0dGFjaChvYmplY3QsIGZpcm0pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gb25SZW5kZXIoKXtcblxuICAgIC8vIEVuc3VyZSBhbGwgYmluZGluZ3MgYXJlIHNvbWV3aGF0IGF0dGFjaGVkIGp1c3QgYmVmb3JlIHJlbmRlcmluZ1xuICAgIHRoaXMuYXR0YWNoKHVuZGVmaW5lZCwgMCk7XG5cbiAgICBmb3IodmFyIGtleSBpbiB0aGlzLl9wcm9wZXJ0aWVzKXtcbiAgICAgICAgdGhpcy5fcHJvcGVydGllc1trZXldLnVwZGF0ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGV0YWNoUHJvcGVydGllcyhmaXJtKXtcbiAgICBmb3IodmFyIGtleSBpbiB0aGlzLl9wcm9wZXJ0aWVzKXtcbiAgICAgICAgdGhpcy5fcHJvcGVydGllc1trZXldLmRldGFjaChmaXJtKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRlc3Ryb3lQcm9wZXJ0aWVzKCl7XG4gICAgZm9yKHZhciBrZXkgaW4gdGhpcy5fcHJvcGVydGllcyl7XG4gICAgICAgIHRoaXMuX3Byb3BlcnRpZXNba2V5XS5kZXN0cm95KCk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBjbG9uZSgpe1xuICAgIHJldHVybiB0aGlzLmZhc3RuKHRoaXMuY29tcG9uZW50Ll90eXBlLCB0aGlzLmNvbXBvbmVudC5fc2V0dGluZ3MsIHRoaXMuY29tcG9uZW50Ll9jaGlsZHJlbi5maWx0ZXIoZnVuY3Rpb24oY2hpbGQpe1xuICAgICAgICAgICAgcmV0dXJuICFjaGlsZC5fdGVtcGxhdGVkO1xuICAgICAgICB9KS5tYXAoZnVuY3Rpb24oY2hpbGQpe1xuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBjaGlsZCA9PT0gJ29iamVjdCcgPyBjaGlsZC5jbG9uZSgpIDogY2hpbGQ7XG4gICAgICAgIH0pXG4gICAgKTtcbn1cblxuZnVuY3Rpb24gZ2V0U2V0QmluZGluZyhuZXdCaW5kaW5nKXtcbiAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0aGlzLmJpbmRpbmc7XG4gICAgfVxuXG4gICAgaWYoIWlzLmJpbmRpbmcobmV3QmluZGluZykpe1xuICAgICAgICBuZXdCaW5kaW5nID0gdGhpcy5mYXN0bi5iaW5kaW5nKG5ld0JpbmRpbmcpO1xuICAgIH1cblxuICAgIGlmKHRoaXMuYmluZGluZyAmJiB0aGlzLmJpbmRpbmcgIT09IG5ld0JpbmRpbmcpe1xuICAgICAgICB0aGlzLmJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIHRoaXMuZW1pdEF0dGFjaCk7XG4gICAgICAgIG5ld0JpbmRpbmcuYXR0YWNoKHRoaXMuYmluZGluZy5fbW9kZWwsIHRoaXMuYmluZGluZy5fZmlybSk7XG4gICAgfVxuXG4gICAgdGhpcy5iaW5kaW5nID0gbmV3QmluZGluZztcblxuICAgIHRoaXMuYmluZGluZy5vbignY2hhbmdlJywgdGhpcy5lbWl0QXR0YWNoKTtcbiAgICB0aGlzLmJpbmRpbmcub24oJ2RldGFjaCcsIHRoaXMuZW1pdERldGFjaCk7XG5cbiAgICB0aGlzLmVtaXRBdHRhY2goKTtcblxuICAgIHJldHVybiB0aGlzLmNvbXBvbmVudDtcbn07XG5cbmZ1bmN0aW9uIGVtaXRBdHRhY2goKXtcbiAgICB2YXIgbmV3Qm91bmQgPSB0aGlzLmJpbmRpbmcoKTtcbiAgICBpZihuZXdCb3VuZCAhPT0gdGhpcy5sYXN0Qm91bmQpe1xuICAgICAgICB0aGlzLmxhc3RCb3VuZCA9IG5ld0JvdW5kO1xuICAgICAgICB0aGlzLnNjb3BlLmF0dGFjaCh0aGlzLmxhc3RCb3VuZCk7XG4gICAgICAgIHRoaXMuY29tcG9uZW50LmVtaXQoJ2F0dGFjaCcsIHRoaXMuc2NvcGUsIDEpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZW1pdERldGFjaCgpe1xuICAgIHRoaXMuY29tcG9uZW50LmVtaXQoJ2RldGFjaCcsIDEpO1xufVxuXG5mdW5jdGlvbiBnZXRTY29wZSgpe1xuICAgIHJldHVybiB0aGlzLnNjb3BlO1xufVxuXG5mdW5jdGlvbiBkZXN0cm95KCl7XG4gICAgaWYodGhpcy5kZXN0cm95ZWQpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuZGVzdHJveWVkID0gdHJ1ZTtcblxuICAgIHRoaXMuY29tcG9uZW50XG4gICAgICAgIC5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3JlbmRlcicpXG4gICAgICAgIC5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2F0dGFjaCcpO1xuXG4gICAgdGhpcy5jb21wb25lbnQuZW1pdCgnZGVzdHJveScpO1xuICAgIHRoaXMuY29tcG9uZW50LmVsZW1lbnQgPSBudWxsO1xuICAgIHRoaXMuc2NvcGUuZGVzdHJveSgpO1xuICAgIHRoaXMuYmluZGluZy5kZXN0cm95KHRydWUpO1xuXG4gICAgcmV0dXJuIHRoaXMuY29tcG9uZW50O1xufVxuXG5mdW5jdGlvbiBhdHRhY2hDb21wb25lbnQob2JqZWN0LCBmaXJtKXtcbiAgICB0aGlzLmJpbmRpbmcuYXR0YWNoKG9iamVjdCwgZmlybSk7XG4gICAgcmV0dXJuIHRoaXMuY29tcG9uZW50O1xufVxuXG5mdW5jdGlvbiBkZXRhY2hDb21wb25lbnQoZmlybSl7XG4gICAgdGhpcy5iaW5kaW5nLmRldGFjaChmaXJtKTtcbiAgICByZXR1cm4gdGhpcy5jb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGlzRGVzdHJveWVkKCl7XG4gICAgcmV0dXJuIHRoaXMuZGVzdHJveWVkO1xufVxuXG5mdW5jdGlvbiBzZXRQcm9wZXJ0eShrZXksIHByb3BlcnR5KXtcblxuICAgIC8vIEFkZCBhIGRlZmF1bHQgcHJvcGVydHkgb3IgdXNlIHRoZSBvbmUgYWxyZWFkeSB0aGVyZVxuICAgIGlmKCFwcm9wZXJ0eSl7XG4gICAgICAgIHByb3BlcnR5ID0gdGhpcy5jb21wb25lbnRba2V5XSB8fCB0aGlzLmZhc3RuLnByb3BlcnR5KCk7XG4gICAgfVxuXG4gICAgdGhpcy5jb21wb25lbnRba2V5XSA9IHByb3BlcnR5O1xuICAgIHRoaXMuY29tcG9uZW50Ll9wcm9wZXJ0aWVzW2tleV0gPSBwcm9wZXJ0eTtcblxuICAgIHJldHVybiB0aGlzLmNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gYmluZEludGVybmFsUHJvcGVydHkoY29tcG9uZW50LCBtb2RlbCwgcHJvcGVydHlOYW1lLCBwcm9wZXJ0eVRyYW5zZm9ybSl7XG4gICAgaWYoIShwcm9wZXJ0eU5hbWUgaW4gY29tcG9uZW50KSl7XG4gICAgICAgIGNvbXBvbmVudC5zZXRQcm9wZXJ0eShwcm9wZXJ0eU5hbWUpO1xuICAgIH1cbiAgICBjb21wb25lbnRbcHJvcGVydHlOYW1lXS5vbignY2hhbmdlJywgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgICBtb2RlbC5zZXQocHJvcGVydHlOYW1lLCBwcm9wZXJ0eVRyYW5zZm9ybSA/IHByb3BlcnR5VHJhbnNmb3JtKHZhbHVlKSA6IHZhbHVlKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlSW50ZXJuYWxTY29wZShkYXRhLCBwcm9wZXJ0eVRyYW5zZm9ybXMpe1xuICAgIHZhciBjb21wb25lbnRTY29wZSA9IHRoaXM7XG4gICAgdmFyIG1vZGVsID0gbmV3IGNvbXBvbmVudFNjb3BlLmZhc3RuLk1vZGVsKGRhdGEpO1xuXG4gICAgZm9yKHZhciBrZXkgaW4gZGF0YSl7XG4gICAgICAgIGJpbmRJbnRlcm5hbFByb3BlcnR5KGNvbXBvbmVudFNjb3BlLmNvbXBvbmVudCwgbW9kZWwsIGtleSwgcHJvcGVydHlUcmFuc2Zvcm1zW2tleV0pO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIGJpbmRpbmc6IGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICByZXR1cm4gY29tcG9uZW50U2NvcGUuZmFzdG4uYmluZGluZy5hcHBseShudWxsLCBhcmd1bWVudHMpLmF0dGFjaChtb2RlbCk7XG4gICAgICAgIH0sXG4gICAgICAgIG1vZGVsOiBtb2RlbFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGV4dGVuZENvbXBvbmVudCh0eXBlLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuXG4gICAgaWYodHlwZSBpbiB0aGlzLnR5cGVzKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29tcG9uZW50O1xuICAgIH1cblxuICAgIGlmKCEodHlwZSBpbiB0aGlzLmZhc3RuLmNvbXBvbmVudHMpKXtcblxuICAgICAgICBpZighKEdFTkVSSUMgaW4gdGhpcy5mYXN0bi5jb21wb25lbnRzKSl7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGNvbXBvbmVudCBvZiB0eXBlIFwiJyArIHR5cGUgKyAnXCIgaXMgbG9hZGVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmZhc3RuLmNvbXBvbmVudHMuX2dlbmVyaWModGhpcy5mYXN0biwgdGhpcy5jb21wb25lbnQsIHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbiwgY3JlYXRlSW50ZXJuYWxTY29wZS5iaW5kKHRoaXMpKTtcblxuICAgICAgICB0aGlzLnR5cGVzLl9nZW5lcmljID0gdHJ1ZTtcbiAgICB9ZWxzZXtcblxuICAgICAgICB0aGlzLmZhc3RuLmNvbXBvbmVudHNbdHlwZV0odGhpcy5mYXN0biwgdGhpcy5jb21wb25lbnQsIHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbiwgY3JlYXRlSW50ZXJuYWxTY29wZS5iaW5kKHRoaXMpKTtcbiAgICB9XG5cbiAgICB0aGlzLnR5cGVzW3R5cGVdID0gdHJ1ZTtcblxuICAgIHJldHVybiB0aGlzLmNvbXBvbmVudDtcbn07XG5cbmZ1bmN0aW9uIGlzVHlwZSh0eXBlKXtcbiAgICByZXR1cm4gdHlwZSBpbiB0aGlzLnR5cGVzO1xufVxuXG5mdW5jdGlvbiBGYXN0bkNvbXBvbmVudChmYXN0biwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICB2YXIgY29tcG9uZW50ID0gdGhpcztcblxuICAgIHZhciBjb21wb25lbnRTY29wZSA9IHtcbiAgICAgICAgdHlwZXM6IHt9LFxuICAgICAgICBmYXN0bjogZmFzdG4sXG4gICAgICAgIGNvbXBvbmVudDogY29tcG9uZW50LFxuICAgICAgICBiaW5kaW5nOiBmYXN0bi5iaW5kaW5nKCcuJyksXG4gICAgICAgIGRlc3Ryb3llZDogZmFsc2UsXG4gICAgICAgIHNjb3BlOiBuZXcgZmFzdG4uTW9kZWwoZmFsc2UpLFxuICAgICAgICBsYXN0Qm91bmQ6IG51bGxcbiAgICB9O1xuXG4gICAgY29tcG9uZW50U2NvcGUuZW1pdEF0dGFjaCA9IGVtaXRBdHRhY2guYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50U2NvcGUuZW1pdERldGFjaCA9IGVtaXREZXRhY2guYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50U2NvcGUuYmluZGluZy5fZGVmYXVsdF9iaW5kaW5nID0gdHJ1ZTtcblxuICAgIGNvbXBvbmVudC5fdHlwZSA9IHR5cGU7XG4gICAgY29tcG9uZW50Ll9wcm9wZXJ0aWVzID0ge307XG4gICAgY29tcG9uZW50Ll9zZXR0aW5ncyA9IHNldHRpbmdzIHx8IHt9O1xuICAgIGNvbXBvbmVudC5fY2hpbGRyZW4gPSBjaGlsZHJlbiA/IGZsYXR0ZW4oY2hpbGRyZW4pIDogW107XG5cbiAgICBjb21wb25lbnQuYXR0YWNoID0gYXR0YWNoQ29tcG9uZW50LmJpbmQoY29tcG9uZW50U2NvcGUpO1xuICAgIGNvbXBvbmVudC5kZXRhY2ggPSBkZXRhY2hDb21wb25lbnQuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LnNjb3BlID0gZ2V0U2NvcGUuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LmRlc3Ryb3kgPSBkZXN0cm95LmJpbmQoY29tcG9uZW50U2NvcGUpO1xuICAgIGNvbXBvbmVudC5kZXN0cm95ZWQgPSBpc0Rlc3Ryb3llZC5iaW5kKGNvbXBvbmVudFNjb3BlKTtcbiAgICBjb21wb25lbnQuYmluZGluZyA9IGdldFNldEJpbmRpbmcuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5ID0gc2V0UHJvcGVydHkuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LmNsb25lID0gY2xvbmUuYmluZChjb21wb25lbnRTY29wZSk7XG4gICAgY29tcG9uZW50LmNoaWxkcmVuID0gc2xpY2UuYmluZChjb21wb25lbnQuX2NoaWxkcmVuKTtcbiAgICBjb21wb25lbnQuZXh0ZW5kID0gZXh0ZW5kQ29tcG9uZW50LmJpbmQoY29tcG9uZW50U2NvcGUpO1xuICAgIGNvbXBvbmVudC5pcyA9IGlzVHlwZS5iaW5kKGNvbXBvbmVudFNjb3BlKTtcblxuICAgIGNvbXBvbmVudC5iaW5kaW5nKGNvbXBvbmVudFNjb3BlLmJpbmRpbmcpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdhdHRhY2gnLCBhdHRhY2hQcm9wZXJ0aWVzLmJpbmQodGhpcykpO1xuICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgb25SZW5kZXIuYmluZCh0aGlzKSk7XG4gICAgY29tcG9uZW50Lm9uKCdkZXRhY2gnLCBkZXRhY2hQcm9wZXJ0aWVzLmJpbmQodGhpcykpO1xuICAgIGNvbXBvbmVudC5vbignZGVzdHJveScsIGRlc3Ryb3lQcm9wZXJ0aWVzLmJpbmQodGhpcykpO1xuXG4gICAgaWYoZmFzdG4uZGVidWcpe1xuICAgICAgICBjb21wb25lbnQub24oJ3JlbmRlcicsIGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBpZihjb21wb25lbnQuZWxlbWVudCAmJiB0eXBlb2YgY29tcG9uZW50LmVsZW1lbnQgPT09ICdvYmplY3QnKXtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQuZWxlbWVudC5fY29tcG9uZW50ID0gY29tcG9uZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59XG5GYXN0bkNvbXBvbmVudC5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEV2ZW50RW1pdHRlci5wcm90b3R5cGUpO1xuRmFzdG5Db21wb25lbnQucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gRmFzdG5Db21wb25lbnQ7XG5GYXN0bkNvbXBvbmVudC5wcm90b3R5cGUuX2Zhc3RuX2NvbXBvbmVudCA9IHRydWU7XG5cbm1vZHVsZS5leHBvcnRzID0gRmFzdG5Db21wb25lbnQ7IiwidmFyIGlzID0gcmVxdWlyZSgnLi9pcycpLFxuICAgIGZpcm1lciA9IHJlcXVpcmUoJy4vZmlybWVyJyksXG4gICAgZnVuY3Rpb25FbWl0dGVyID0gcmVxdWlyZSgnZnVuY3Rpb24tZW1pdHRlcicpLFxuICAgIHNldFByb3RvdHlwZU9mID0gcmVxdWlyZSgnc2V0cHJvdG90eXBlb2YnKSxcbiAgICBzYW1lID0gcmVxdWlyZSgnc2FtZS12YWx1ZScpO1xuXG5mdW5jdGlvbiBub29wKHgpe1xuICAgIHJldHVybiB4O1xufVxuXG5mdW5jdGlvbiBmdXNlQmluZGluZygpe1xuICAgIHZhciBmYXN0biA9IHRoaXMsXG4gICAgICAgIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuXG4gICAgdmFyIGJpbmRpbmdzID0gYXJncy5zbGljZSgpLFxuICAgICAgICB0cmFuc2Zvcm0gPSBiaW5kaW5ncy5wb3AoKSxcbiAgICAgICAgdXBkYXRlVHJhbnNmb3JtLFxuICAgICAgICByZXN1bHRCaW5kaW5nID0gY3JlYXRlQmluZGluZy5jYWxsKGZhc3RuLCAncmVzdWx0JyksXG4gICAgICAgIHNlbGZDaGFuZ2luZztcblxuICAgIHJlc3VsdEJpbmRpbmcuX2FyZ3VtZW50cyA9IGFyZ3M7XG5cbiAgICBpZih0eXBlb2YgYmluZGluZ3NbYmluZGluZ3MubGVuZ3RoLTFdID09PSAnZnVuY3Rpb24nICYmICFpcy5iaW5kaW5nKGJpbmRpbmdzW2JpbmRpbmdzLmxlbmd0aC0xXSkpe1xuICAgICAgICB1cGRhdGVUcmFuc2Zvcm0gPSB0cmFuc2Zvcm07XG4gICAgICAgIHRyYW5zZm9ybSA9IGJpbmRpbmdzLnBvcCgpO1xuICAgIH1cblxuICAgIHJlc3VsdEJpbmRpbmcuX21vZGVsLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICAgIHJlc3VsdEJpbmRpbmcuX3NldCA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgaWYodXBkYXRlVHJhbnNmb3JtKXtcbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgICAgICB2YXIgbmV3VmFsdWUgPSB1cGRhdGVUcmFuc2Zvcm0odmFsdWUpO1xuICAgICAgICAgICAgaWYoIXNhbWUobmV3VmFsdWUsIGJpbmRpbmdzWzBdKCkpKXtcbiAgICAgICAgICAgICAgICBiaW5kaW5nc1swXShuZXdWYWx1ZSk7XG4gICAgICAgICAgICAgICAgcmVzdWx0QmluZGluZy5fY2hhbmdlKG5ld1ZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNlbGZDaGFuZ2luZyA9IGZhbHNlO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHJlc3VsdEJpbmRpbmcuX2NoYW5nZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlKCl7XG4gICAgICAgIGlmKHNlbGZDaGFuZ2luZyl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcmVzdWx0QmluZGluZyh0cmFuc2Zvcm0uYXBwbHkobnVsbCwgYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpe1xuICAgICAgICAgICAgcmV0dXJuIGJpbmRpbmcoKTtcbiAgICAgICAgfSkpKTtcbiAgICB9XG5cbiAgICByZXN1bHRCaW5kaW5nLm9uKCdkZXRhY2gnLCBmdW5jdGlvbihmaXJtKXtcbiAgICAgICAgYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nLCBpbmRleCl7XG4gICAgICAgICAgICBiaW5kaW5nLmRldGFjaChmaXJtKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXN1bHRCaW5kaW5nLm9uY2UoJ2Rlc3Ryb3knLCBmdW5jdGlvbihzb2Z0KXtcbiAgICAgICAgYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nLCBpbmRleCl7XG4gICAgICAgICAgICBiaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCBjaGFuZ2UpO1xuICAgICAgICAgICAgYmluZGluZy5kZXN0cm95KHNvZnQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZywgaW5kZXgpe1xuICAgICAgICBpZighaXMuYmluZGluZyhiaW5kaW5nKSl7XG4gICAgICAgICAgICBiaW5kaW5nID0gY3JlYXRlQmluZGluZy5jYWxsKGZhc3RuLCBiaW5kaW5nKTtcbiAgICAgICAgICAgIGJpbmRpbmdzLnNwbGljZShpbmRleCwxLGJpbmRpbmcpO1xuICAgICAgICB9XG4gICAgICAgIGJpbmRpbmcub24oJ2NoYW5nZScsIGNoYW5nZSk7XG4gICAgfSk7XG5cbiAgICB2YXIgbGFzdEF0dGFjaGVkO1xuICAgIHJlc3VsdEJpbmRpbmcub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKG9iamVjdCl7XG4gICAgICAgIHNlbGZDaGFuZ2luZyA9IHRydWU7XG4gICAgICAgIGJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZyl7XG4gICAgICAgICAgICBiaW5kaW5nLmF0dGFjaChvYmplY3QsIDEpO1xuICAgICAgICB9KTtcbiAgICAgICAgc2VsZkNoYW5naW5nID0gZmFsc2U7XG4gICAgICAgIGlmKGxhc3RBdHRhY2hlZCAhPT0gb2JqZWN0KXtcbiAgICAgICAgICAgIGNoYW5nZSgpO1xuICAgICAgICB9XG4gICAgICAgIGxhc3RBdHRhY2hlZCA9IG9iamVjdDtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHRCaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVWYWx1ZUJpbmRpbmcoZmFzdG4pe1xuICAgIHZhciB2YWx1ZUJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nLmNhbGwoZmFzdG4sICd2YWx1ZScpO1xuICAgIHZhbHVlQmluZGluZy5hdHRhY2ggPSBmdW5jdGlvbigpe3JldHVybiB2YWx1ZUJpbmRpbmc7fTtcbiAgICB2YWx1ZUJpbmRpbmcuZGV0YWNoID0gZnVuY3Rpb24oKXtyZXR1cm4gdmFsdWVCaW5kaW5nO307XG4gICAgcmV0dXJuIHZhbHVlQmluZGluZztcbn1cblxuZnVuY3Rpb24gYmluZGluZ1RlbXBsYXRlKG5ld1ZhbHVlKXtcbiAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0aGlzLnZhbHVlO1xuICAgIH1cblxuICAgIGlmKHRoaXMuYmluZGluZy5fZmFzdG5fYmluZGluZyA9PT0gJy4nKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuYmluZGluZy5fc2V0KG5ld1ZhbHVlKTtcbiAgICByZXR1cm4gdGhpcy5iaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBtb2RlbEF0dGFjaEhhbmRsZXIoZGF0YSl7XG4gICAgdmFyIGJpbmRpbmdTY29wZSA9IHRoaXM7XG4gICAgYmluZGluZ1Njb3BlLmJpbmRpbmcuX21vZGVsLmF0dGFjaChkYXRhKTtcbiAgICBiaW5kaW5nU2NvcGUuYmluZGluZy5fY2hhbmdlKGJpbmRpbmdTY29wZS5iaW5kaW5nLl9tb2RlbC5nZXQoYmluZGluZ1Njb3BlLnBhdGgpKTtcbiAgICBiaW5kaW5nU2NvcGUuYmluZGluZy5lbWl0KCdhdHRhY2gnLCBkYXRhLCAxKTtcbn1cblxuZnVuY3Rpb24gbW9kZWxEZXRhY2hIYW5kbGVyKCl7XG4gICAgdGhpcy5iaW5kaW5nLl9tb2RlbC5kZXRhY2goKTtcbn1cblxuZnVuY3Rpb24gYXR0YWNoKG9iamVjdCwgZmlybSl7XG4gICAgdmFyIGJpbmRpbmdTY29wZSA9IHRoaXM7XG4gICAgdmFyIGJpbmRpbmcgPSBiaW5kaW5nU2NvcGUuYmluZGluZztcbiAgICAvLyBJZiB0aGUgYmluZGluZyBpcyBiZWluZyBhc2tlZCB0byBhdHRhY2ggbG9vc2x5IHRvIGFuIG9iamVjdCxcbiAgICAvLyBidXQgaXQgaGFzIGFscmVhZHkgYmVlbiBkZWZpbmVkIGFzIGJlaW5nIGZpcm1seSBhdHRhY2hlZCwgZG8gbm90IGF0dGFjaC5cbiAgICBpZihmaXJtZXIoYmluZGluZywgZmlybSkpe1xuICAgICAgICByZXR1cm4gYmluZGluZztcbiAgICB9XG5cbiAgICBiaW5kaW5nLl9maXJtID0gZmlybTtcblxuICAgIHZhciBpc01vZGVsID0gYmluZGluZ1Njb3BlLmZhc3RuLmlzTW9kZWwob2JqZWN0KTtcblxuICAgIGlmKGlzTW9kZWwgJiYgYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwgPT09IG9iamVjdCl7XG4gICAgICAgIHJldHVybiBiaW5kaW5nO1xuICAgIH1cblxuICAgIGlmKGJpbmRpbmdTY29wZS5hdHRhY2hlZE1vZGVsKXtcbiAgICAgICAgYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwucmVtb3ZlTGlzdGVuZXIoJ2F0dGFjaCcsIGJpbmRpbmdTY29wZS5tb2RlbEF0dGFjaEhhbmRsZXIpO1xuICAgICAgICBiaW5kaW5nU2NvcGUuYXR0YWNoZWRNb2RlbC5yZW1vdmVMaXN0ZW5lcignZGV0YWNoJywgYmluZGluZ1Njb3BlLm1vZGVsRGV0YWNoSGFuZGxlcik7XG4gICAgICAgIGJpbmRpbmdTY29wZS5hdHRhY2hlZE1vZGVsID0gbnVsbDtcbiAgICB9XG5cbiAgICBpZihpc01vZGVsKXtcbiAgICAgICAgYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwgPSBvYmplY3Q7XG4gICAgICAgIGJpbmRpbmdTY29wZS5hdHRhY2hlZE1vZGVsLm9uKCdhdHRhY2gnLCBiaW5kaW5nU2NvcGUubW9kZWxBdHRhY2hIYW5kbGVyKTtcbiAgICAgICAgYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwub24oJ2RldGFjaCcsIGJpbmRpbmdTY29wZS5tb2RlbERldGFjaEhhbmRsZXIpO1xuICAgICAgICBvYmplY3QgPSBvYmplY3QuX21vZGVsO1xuICAgIH1cblxuICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgIG9iamVjdCA9IHt9O1xuICAgIH1cblxuICAgIGlmKGJpbmRpbmcuX21vZGVsLl9tb2RlbCA9PT0gb2JqZWN0KXtcbiAgICAgICAgcmV0dXJuIGJpbmRpbmc7XG4gICAgfVxuXG4gICAgYmluZGluZ1Njb3BlLm1vZGVsQXR0YWNoSGFuZGxlcihvYmplY3QpO1xuXG4gICAgcmV0dXJuIGJpbmRpbmc7XG59O1xuXG5mdW5jdGlvbiBkZXRhY2goZmlybSl7XG4gICAgaWYoZmlybWVyKHRoaXMuYmluZGluZywgZmlybSkpe1xuICAgICAgICByZXR1cm4gdGhpcy5iaW5kaW5nO1xuICAgIH1cblxuICAgIHRoaXMudmFsdWUgPSB1bmRlZmluZWQ7XG4gICAgaWYodGhpcy5iaW5kaW5nLl9tb2RlbC5pc0F0dGFjaGVkKCkpe1xuICAgICAgICB0aGlzLmJpbmRpbmcuX21vZGVsLmRldGFjaCgpO1xuICAgIH1cbiAgICB0aGlzLmJpbmRpbmcuZW1pdCgnZGV0YWNoJywgMSk7XG4gICAgcmV0dXJuIHRoaXMuYmluZGluZztcbn1cblxuZnVuY3Rpb24gc2V0KG5ld1ZhbHVlKXtcbiAgICB2YXIgYmluZGluZ1Njb3BlID0gdGhpcztcbiAgICBpZihzYW1lKGJpbmRpbmdTY29wZS5iaW5kaW5nLl9tb2RlbC5nZXQoYmluZGluZ1Njb3BlLnBhdGgpLCBuZXdWYWx1ZSkpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmKCFiaW5kaW5nU2NvcGUuYmluZGluZy5fbW9kZWwuaXNBdHRhY2hlZCgpKXtcbiAgICAgICAgYmluZGluZ1Njb3BlLmJpbmRpbmcuX21vZGVsLmF0dGFjaChiaW5kaW5nU2NvcGUuYmluZGluZy5fbW9kZWwuZ2V0KCcuJykpO1xuICAgIH1cbiAgICBiaW5kaW5nU2NvcGUuYmluZGluZy5fbW9kZWwuc2V0KGJpbmRpbmdTY29wZS5wYXRoLCBuZXdWYWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGNoYW5nZShuZXdWYWx1ZSl7XG4gICAgdmFyIGJpbmRpbmdTY29wZSA9IHRoaXM7XG4gICAgYmluZGluZ1Njb3BlLnZhbHVlID0gbmV3VmFsdWU7XG4gICAgYmluZGluZ1Njb3BlLmJpbmRpbmcuZW1pdCgnY2hhbmdlJywgYmluZGluZ1Njb3BlLmJpbmRpbmcoKSk7XG59XG5cbmZ1bmN0aW9uIGNsb25lKGtlZXBBdHRhY2htZW50KXtcbiAgICB2YXIgYmluZGluZ1Njb3BlID0gdGhpcztcbiAgICB2YXIgbmV3QmluZGluZyA9IGNyZWF0ZUJpbmRpbmcuYXBwbHkoYmluZGluZ1Njb3BlLmZhc3RuLCBiaW5kaW5nU2NvcGUuYmluZGluZy5fYXJndW1lbnRzKTtcblxuICAgIGlmKGtlZXBBdHRhY2htZW50KXtcbiAgICAgICAgbmV3QmluZGluZy5hdHRhY2goYmluZGluZ1Njb3BlLmF0dGFjaGVkTW9kZWwgfHwgYmluZGluZ1Njb3BlLmJpbmRpbmcuX21vZGVsLl9tb2RlbCwgYmluZGluZ1Njb3BlLmJpbmRpbmcuX2Zpcm0pO1xuICAgIH1cblxuICAgIHJldHVybiBuZXdCaW5kaW5nO1xufVxuXG5mdW5jdGlvbiBkZXN0cm95KHNvZnQpe1xuICAgIHZhciBiaW5kaW5nU2NvcGUgPSB0aGlzO1xuICAgIGlmKGJpbmRpbmdTY29wZS5pc0Rlc3Ryb3llZCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYoc29mdCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYmluZGluZ1Njb3BlLmlzRGVzdHJveWVkID0gdHJ1ZTtcbiAgICBiaW5kaW5nU2NvcGUuYmluZGluZy5lbWl0KCdkZXN0cm95JywgdHJ1ZSk7XG4gICAgYmluZGluZ1Njb3BlLmJpbmRpbmcuZGV0YWNoKCk7XG4gICAgYmluZGluZ1Njb3BlLmJpbmRpbmcuX21vZGVsLmRlc3Ryb3koKTtcbn1cblxuZnVuY3Rpb24gZGVzdHJveWVkKCl7XG4gICAgcmV0dXJuIHRoaXMuaXNEZXN0cm95ZWQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJpbmRpbmcocGF0aCwgbW9yZSl7XG4gICAgdmFyIGZhc3RuID0gdGhpcztcblxuICAgIGlmKG1vcmUpeyAvLyB1c2VkIGluc3RlYWQgb2YgYXJndW1lbnRzLmxlbmd0aCBmb3IgcGVyZm9ybWFuY2VcbiAgICAgICAgcmV0dXJuIGZ1c2VCaW5kaW5nLmFwcGx5KGZhc3RuLCBhcmd1bWVudHMpO1xuICAgIH1cblxuICAgIGlmKGlzLmJpbmRpbmcocGF0aCkpe1xuICAgICAgICByZXR1cm4gY3JlYXRlQmluZGluZy5jYWxsKHRoaXMsIHBhdGgsIG5vb3ApO1xuICAgIH1cblxuICAgIGlmKHBhdGggPT0gbnVsbCl7XG4gICAgICAgIHJldHVybiBjcmVhdGVWYWx1ZUJpbmRpbmcoZmFzdG4pO1xuICAgIH1cblxuICAgIHZhciBiaW5kaW5nU2NvcGUgPSB7XG4gICAgICAgICAgICBmYXN0bjogZmFzdG4sXG4gICAgICAgICAgICBwYXRoOiBwYXRoXG4gICAgICAgIH0sXG4gICAgICAgIGJpbmRpbmcgPSBiaW5kaW5nU2NvcGUuYmluZGluZyA9IGJpbmRpbmdUZW1wbGF0ZS5iaW5kKGJpbmRpbmdTY29wZSk7XG5cbiAgICBzZXRQcm90b3R5cGVPZihiaW5kaW5nLCBmdW5jdGlvbkVtaXR0ZXIpO1xuICAgIGJpbmRpbmcuc2V0TWF4TGlzdGVuZXJzKDEwMDAwKTtcbiAgICBiaW5kaW5nLl9hcmd1bWVudHMgPSBbcGF0aF07XG4gICAgYmluZGluZy5fbW9kZWwgPSBuZXcgZmFzdG4uTW9kZWwoZmFsc2UpO1xuICAgIGJpbmRpbmcuX2Zhc3RuX2JpbmRpbmcgPSBwYXRoO1xuICAgIGJpbmRpbmcuX2Zpcm0gPSAtSW5maW5pdHk7XG5cbiAgICBiaW5kaW5nU2NvcGUubW9kZWxBdHRhY2hIYW5kbGVyID0gbW9kZWxBdHRhY2hIYW5kbGVyLmJpbmQoYmluZGluZ1Njb3BlKTtcbiAgICBiaW5kaW5nU2NvcGUubW9kZWxEZXRhY2hIYW5kbGVyID0gbW9kZWxEZXRhY2hIYW5kbGVyLmJpbmQoYmluZGluZ1Njb3BlKTtcblxuICAgIGJpbmRpbmcuYXR0YWNoID0gYXR0YWNoLmJpbmQoYmluZGluZ1Njb3BlKTtcbiAgICBiaW5kaW5nLmRldGFjaCA9IGRldGFjaC5iaW5kKGJpbmRpbmdTY29wZSk7XG4gICAgYmluZGluZy5fc2V0ID0gc2V0LmJpbmQoYmluZGluZ1Njb3BlKTtcbiAgICBiaW5kaW5nLl9jaGFuZ2UgPSBjaGFuZ2UuYmluZChiaW5kaW5nU2NvcGUpO1xuICAgIGJpbmRpbmcuY2xvbmUgPSBjbG9uZS5iaW5kKGJpbmRpbmdTY29wZSk7XG4gICAgYmluZGluZy5kZXN0cm95ID0gZGVzdHJveS5iaW5kKGJpbmRpbmdTY29wZSk7XG4gICAgYmluZGluZy5kZXN0cm95ZWQgPSBkZXN0cm95ZWQuYmluZChiaW5kaW5nU2NvcGUpO1xuXG4gICAgaWYocGF0aCAhPT0gJy4nKXtcbiAgICAgICAgYmluZGluZy5fbW9kZWwub24ocGF0aCwgYmluZGluZy5fY2hhbmdlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYmluZGluZztcbn1cblxuZnVuY3Rpb24gZnJvbSh2YWx1ZU9yQmluZGluZyl7XG4gICAgaWYoaXMuYmluZGluZyh2YWx1ZU9yQmluZGluZykpe1xuICAgICAgICByZXR1cm4gdmFsdWVPckJpbmRpbmc7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IHRoaXMoKTtcbiAgICByZXN1bHQodmFsdWVPckJpbmRpbmcpXG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZhc3RuKXtcbiAgICB2YXIgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcuYmluZChmYXN0bik7XG4gICAgYmluZGluZy5mcm9tID0gZnJvbS5iaW5kKGJpbmRpbmcpO1xuICAgIHJldHVybiBiaW5kaW5nO1xufTsiLCJmdW5jdGlvbiBpbnNlcnRDaGlsZChmYXN0biwgY29udGFpbmVyLCBjaGlsZCwgaW5kZXgpe1xuICAgIGlmKGNoaWxkID09IG51bGwgfHwgY2hpbGQgPT09IGZhbHNlKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBjdXJyZW50SW5kZXggPSBjb250YWluZXIuX2NoaWxkcmVuLmluZGV4T2YoY2hpbGQpLFxuICAgICAgICBuZXdDb21wb25lbnQgPSBmYXN0bi50b0NvbXBvbmVudChjaGlsZCk7XG5cbiAgICBpZihuZXdDb21wb25lbnQgIT09IGNoaWxkICYmIH5jdXJyZW50SW5kZXgpe1xuICAgICAgICBjb250YWluZXIuX2NoaWxkcmVuLnNwbGljZShjdXJyZW50SW5kZXgsIDEsIG5ld0NvbXBvbmVudCk7XG4gICAgfVxuXG4gICAgaWYoIX5jdXJyZW50SW5kZXggfHwgbmV3Q29tcG9uZW50ICE9PSBjaGlsZCl7XG4gICAgICAgIG5ld0NvbXBvbmVudC5hdHRhY2goY29udGFpbmVyLnNjb3BlKCksIDEpO1xuICAgIH1cblxuICAgIGlmKGN1cnJlbnRJbmRleCAhPT0gaW5kZXgpe1xuICAgICAgICBpZih+Y3VycmVudEluZGV4KXtcbiAgICAgICAgICAgIGNvbnRhaW5lci5fY2hpbGRyZW4uc3BsaWNlKGN1cnJlbnRJbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGFpbmVyLl9jaGlsZHJlbi5zcGxpY2UoaW5kZXgsIDAsIG5ld0NvbXBvbmVudCk7XG4gICAgfVxuXG4gICAgaWYoY29udGFpbmVyLmVsZW1lbnQpe1xuICAgICAgICBpZighbmV3Q29tcG9uZW50LmVsZW1lbnQpe1xuICAgICAgICAgICAgbmV3Q29tcG9uZW50LnJlbmRlcigpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRhaW5lci5faW5zZXJ0KG5ld0NvbXBvbmVudC5lbGVtZW50LCBpbmRleCk7XG4gICAgICAgIG5ld0NvbXBvbmVudC5lbWl0KCdpbnNlcnQnLCBjb250YWluZXIpO1xuICAgICAgICBjb250YWluZXIuZW1pdCgnY2hpbGRJbnNlcnQnLCBuZXdDb21wb25lbnQpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0Q29udGFpbmVyRWxlbWVudCgpe1xuICAgIHJldHVybiB0aGlzLmNvbnRhaW5lckVsZW1lbnQgfHwgdGhpcy5lbGVtZW50O1xufVxuXG5mdW5jdGlvbiBpbnNlcnQoY2hpbGQsIGluZGV4KXtcbiAgICB2YXIgY2hpbGRDb21wb25lbnQgPSBjaGlsZCxcbiAgICAgICAgY29udGFpbmVyID0gdGhpcy5jb250YWluZXIsXG4gICAgICAgIGZhc3RuID0gdGhpcy5mYXN0bjtcblxuICAgIGlmKGluZGV4ICYmIHR5cGVvZiBpbmRleCA9PT0gJ29iamVjdCcpe1xuICAgICAgICBjaGlsZENvbXBvbmVudCA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgaWYoaXNOYU4oaW5kZXgpKXtcbiAgICAgICAgaW5kZXggPSBjb250YWluZXIuX2NoaWxkcmVuLmxlbmd0aDtcbiAgICB9XG5cbiAgICBpZihBcnJheS5pc0FycmF5KGNoaWxkQ29tcG9uZW50KSl7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hpbGRDb21wb25lbnQubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnRhaW5lci5pbnNlcnQoY2hpbGRDb21wb25lbnRbaV0sIGkgKyBpbmRleCk7XG4gICAgICAgIH1cbiAgICB9ZWxzZXtcbiAgICAgICAgaW5zZXJ0Q2hpbGQoZmFzdG4sIGNvbnRhaW5lciwgY2hpbGRDb21wb25lbnQsIGluZGV4KTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29udGFpbmVyO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZhc3RuLCBjb21wb25lbnQsIHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgY29tcG9uZW50Lmluc2VydCA9IGluc2VydC5iaW5kKHtcbiAgICAgICAgY29udGFpbmVyOiBjb21wb25lbnQsXG4gICAgICAgIGZhc3RuOiBmYXN0blxuICAgIH0pO1xuXG4gICAgY29tcG9uZW50Ll9pbnNlcnQgPSBmdW5jdGlvbihlbGVtZW50LCBpbmRleCl7XG4gICAgICAgIHZhciBjb250YWluZXJFbGVtZW50ID0gY29tcG9uZW50LmdldENvbnRhaW5lckVsZW1lbnQoKTtcbiAgICAgICAgaWYoIWNvbnRhaW5lckVsZW1lbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoY29udGFpbmVyRWxlbWVudC5jaGlsZE5vZGVzW2luZGV4XSA9PT0gZWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb250YWluZXJFbGVtZW50Lmluc2VydEJlZm9yZShlbGVtZW50LCBjb250YWluZXJFbGVtZW50LmNoaWxkTm9kZXNbaW5kZXhdKTtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LnJlbW92ZSA9IGZ1bmN0aW9uKGNoaWxkQ29tcG9uZW50KXtcbiAgICAgICAgdmFyIGluZGV4ID0gY29tcG9uZW50Ll9jaGlsZHJlbi5pbmRleE9mKGNoaWxkQ29tcG9uZW50KTtcbiAgICAgICAgaWYofmluZGV4KXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5fY2hpbGRyZW4uc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgY2hpbGRDb21wb25lbnQuZGV0YWNoKDEpO1xuXG4gICAgICAgIGlmKGNoaWxkQ29tcG9uZW50LmVsZW1lbnQpe1xuICAgICAgICAgICAgY29tcG9uZW50Ll9yZW1vdmUoY2hpbGRDb21wb25lbnQuZWxlbWVudCk7XG4gICAgICAgICAgICBjaGlsZENvbXBvbmVudC5lbWl0KCdyZW1vdmUnLCBjb21wb25lbnQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudC5lbWl0KCdjaGlsZFJlbW92ZScsIGNoaWxkQ29tcG9uZW50KTtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50Ll9yZW1vdmUgPSBmdW5jdGlvbihlbGVtZW50KXtcbiAgICAgICAgdmFyIGNvbnRhaW5lckVsZW1lbnQgPSBjb21wb25lbnQuZ2V0Q29udGFpbmVyRWxlbWVudCgpO1xuXG4gICAgICAgIGlmKCFlbGVtZW50IHx8ICFjb250YWluZXJFbGVtZW50IHx8IGVsZW1lbnQucGFyZW50Tm9kZSAhPT0gY29udGFpbmVyRWxlbWVudCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb250YWluZXJFbGVtZW50LnJlbW92ZUNoaWxkKGVsZW1lbnQpO1xuICAgIH07XG5cbiAgICBjb21wb25lbnQuZW1wdHkgPSBmdW5jdGlvbigpe1xuICAgICAgICB3aGlsZShjb21wb25lbnQuX2NoaWxkcmVuLmxlbmd0aCl7XG4gICAgICAgICAgICBjb21wb25lbnQucmVtb3ZlKGNvbXBvbmVudC5fY2hpbGRyZW4ucG9wKCkpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5yZXBsYWNlQ2hpbGQgPSBmdW5jdGlvbihvbGRDaGlsZCwgbmV3Q2hpbGQpe1xuICAgICAgICB2YXIgaW5kZXggPSBjb21wb25lbnQuX2NoaWxkcmVuLmluZGV4T2Yob2xkQ2hpbGQpO1xuXG4gICAgICAgIGlmKCF+aW5kZXgpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50LnJlbW92ZShvbGRDaGlsZCk7XG4gICAgICAgIGNvbXBvbmVudC5pbnNlcnQobmV3Q2hpbGQsIGluZGV4KTtcbiAgICB9O1xuXG4gICAgY29tcG9uZW50LmdldENvbnRhaW5lckVsZW1lbnQgPSBnZXRDb250YWluZXJFbGVtZW50LmJpbmQoY29tcG9uZW50KTtcblxuICAgIGNvbXBvbmVudC5vbigncmVuZGVyJywgY29tcG9uZW50Lmluc2VydC5iaW5kKG51bGwsIGNvbXBvbmVudC5fY2hpbGRyZW4sIDApKTtcblxuICAgIGNvbXBvbmVudC5vbignYXR0YWNoJywgZnVuY3Rpb24obW9kZWwsIGZpcm0pe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29tcG9uZW50Ll9jaGlsZHJlbi5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb21wb25lbnQuX2NoaWxkcmVuW2ldKSl7XG4gICAgICAgICAgICAgICAgY29tcG9uZW50Ll9jaGlsZHJlbltpXS5hdHRhY2gobW9kZWwsIGZpcm0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBjb21wb25lbnQub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbihkYXRhLCBmaXJtKXtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbXBvbmVudC5fY2hpbGRyZW4ubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29tcG9uZW50Ll9jaGlsZHJlbltpXSkpe1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5fY2hpbGRyZW5baV0uZGVzdHJveShmaXJtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbn07IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihleHRyYSl7XG4gICAgdmFyIGNvbXBvbmVudHMgPSB7XG4gICAgICAgIC8vIFRoZSBfZ2VuZXJpYyBjb21wb25lbnQgaXMgYSBjYXRjaC1hbGwgZm9yIGFueSBjb21wb25lbnQgdHlwZSB0aGF0XG4gICAgICAgIC8vICBkb2VzbnQgbWF0Y2ggYW55IG90aGVyIGNvbXBvbmVudCBjb25zdHJ1Y3RvciwgZWc6ICdkaXYnXG4gICAgICAgIF9nZW5lcmljOiByZXF1aXJlKCcuL2dlbmVyaWNDb21wb25lbnQnKSxcblxuICAgICAgICAvLyBUaGUgdGV4dCBjb21wb25lbnQgaXMgdXNlZCB0byByZW5kZXIgdGV4dCBvciBiaW5kaW5ncyBwYXNzZWQgYXMgY2hpbGRyZW4gdG8gb3RoZXIgY29tcG9uZW50cy5cbiAgICAgICAgdGV4dDogcmVxdWlyZSgnLi90ZXh0Q29tcG9uZW50JyksXG5cbiAgICAgICAgLy8gVGhlIGxpc3QgY29tcG9uZW50IGlzIHVzZWQgdG8gcmVuZGVyIGl0ZW1zIGJhc2VkIG9uIGEgc2V0IG9mIGRhdGEuXG4gICAgICAgIGxpc3Q6IHJlcXVpcmUoJy4vbGlzdENvbXBvbmVudCcpLFxuXG4gICAgICAgIC8vIFRoZSB0ZW1wbGF0ZXIgY29tcG9uZW50IGlzIHVzZWQgdG8gcmVuZGVyIG9uZSBpdGVtIGJhc2VkIG9uIHNvbWUgdmFsdWUuXG4gICAgICAgIHRlbXBsYXRlcjogcmVxdWlyZSgnLi90ZW1wbGF0ZXJDb21wb25lbnQnKVxuICAgIH07XG5cbiAgICBpZihleHRyYSl7XG4gICAgICAgIE9iamVjdC5rZXlzKGV4dHJhKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSl7XG4gICAgICAgICAgICBjb21wb25lbnRzW2tleV0gPSBleHRyYVtrZXldO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcG9uZW50cztcbn0iLCJ2YXIgc2V0aWZ5ID0gcmVxdWlyZSgnc2V0aWZ5JyksXG4gICAgY2xhc3Npc3QgPSByZXF1aXJlKCdjbGFzc2lzdCcpO1xuXG5mdW5jdGlvbiB1cGRhdGVUZXh0UHJvcGVydHkoZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICByZXR1cm4gZWxlbWVudC50ZXh0Q29udGVudDtcbiAgICB9XG4gICAgZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGNsYXNzOiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKCFnZW5lcmljLl9jbGFzc2lzdCl7XG4gICAgICAgICAgICBnZW5lcmljLl9jbGFzc2lzdCA9IGNsYXNzaXN0KGVsZW1lbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA8IDMpe1xuICAgICAgICAgICAgcmV0dXJuIGdlbmVyaWMuX2NsYXNzaXN0KCk7XG4gICAgICAgIH1cblxuICAgICAgICBnZW5lcmljLl9jbGFzc2lzdCh2YWx1ZSk7XG4gICAgfSxcbiAgICBkaXNwbGF5OiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuc3R5bGUuZGlzcGxheSAhPT0gJ25vbmUnO1xuICAgICAgICB9XG4gICAgICAgIGVsZW1lbnQuc3R5bGUuZGlzcGxheSA9IHZhbHVlID8gbnVsbCA6ICdub25lJztcbiAgICB9LFxuICAgIGRpc2FibGVkOiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmKHZhbHVlKXtcbiAgICAgICAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICdkaXNhYmxlZCcpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgICAgICB9XG4gICAgfSxcbiAgICB0ZXh0Q29udGVudDogdXBkYXRlVGV4dFByb3BlcnR5LFxuICAgIGlubmVyVGV4dDogdXBkYXRlVGV4dFByb3BlcnR5LFxuICAgIGlubmVySFRNTDogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmlubmVySFRNTDtcbiAgICAgICAgfVxuICAgICAgICBlbGVtZW50LmlubmVySFRNTCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gICAgfSxcbiAgICB2YWx1ZTogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICB2YXIgaW5wdXRUeXBlID0gZWxlbWVudC50eXBlO1xuXG4gICAgICAgIGlmKGVsZW1lbnQubm9kZU5hbWUgPT09ICdJTlBVVCcgJiYgaW5wdXRUeXBlID09PSAnZGF0ZScpe1xuICAgICAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudmFsdWUgPyBuZXcgRGF0ZShlbGVtZW50LnZhbHVlLnJlcGxhY2UoLy0vZywnLycpLnJlcGxhY2UoJ1QnLCcgJykpIDogbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFsdWUgPSB2YWx1ZSAhPSBudWxsID8gbmV3IERhdGUodmFsdWUpIDogbnVsbDtcblxuICAgICAgICAgICAgaWYoIXZhbHVlIHx8IGlzTmFOKHZhbHVlKSl7XG4gICAgICAgICAgICAgICAgZWxlbWVudC52YWx1ZSA9IG51bGw7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBlbGVtZW50LnZhbHVlID0gW1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZS5nZXRGdWxsWWVhcigpLFxuICAgICAgICAgICAgICAgICAgICAoJzAnICsgKHZhbHVlLmdldE1vbnRoKCkgKyAxKSkuc2xpY2UoLTIpLFxuICAgICAgICAgICAgICAgICAgICAoJzAnICsgdmFsdWUuZ2V0RGF0ZSgpKS5zbGljZSgtMilcbiAgICAgICAgICAgICAgICBdLmpvaW4oJy0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYodmFsdWUgPT09IHVuZGVmaW5lZCl7XG4gICAgICAgICAgICB2YWx1ZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBpZihlbGVtZW50Lm5vZGVOYW1lID09PSAnUFJPR1JFU1MnKXtcbiAgICAgICAgICAgIHZhbHVlID0gcGFyc2VGbG9hdCh2YWx1ZSkgfHwgMDtcbiAgICAgICAgfVxuXG4gICAgICAgIHNldGlmeShlbGVtZW50LCB2YWx1ZSk7XG4gICAgfSxcbiAgICBtYXg6IGZ1bmN0aW9uKGdlbmVyaWMsIGVsZW1lbnQsIHZhbHVlKSB7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihlbGVtZW50Lm5vZGVOYW1lID09PSAnUFJPR1JFU1MnKXtcbiAgICAgICAgICAgIHZhbHVlID0gcGFyc2VGbG9hdCh2YWx1ZSkgfHwgMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGVsZW1lbnQubWF4ID0gdmFsdWU7XG4gICAgfSxcbiAgICBzdHlsZTogZnVuY3Rpb24oZ2VuZXJpYywgZWxlbWVudCwgdmFsdWUpe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50LnN0eWxlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyl7XG4gICAgICAgICAgICBlbGVtZW50LnN0eWxlID0gdmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IodmFyIGtleSBpbiB2YWx1ZSl7XG4gICAgICAgICAgICBlbGVtZW50LnN0eWxlW2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgICB9XG4gICAgfSxcbiAgICB0eXBlOiBmdW5jdGlvbihnZW5lcmljLCBlbGVtZW50LCB2YWx1ZSl7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudHlwZTtcbiAgICAgICAgfVxuICAgICAgICBlbGVtZW50LnNldEF0dHJpYnV0ZSgndHlwZScsIHZhbHVlKTtcbiAgICB9XG59OyIsIi8vIElzIHRoZSBlbnRpdHkgZmlybWVyIHRoYW4gdGhlIG5ldyBmaXJtbmVzc1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihlbnRpdHksIGZpcm0pe1xuICAgIGlmKGZpcm0gIT0gbnVsbCAmJiAoZW50aXR5Ll9maXJtID09PSB1bmRlZmluZWQgfHwgZmlybSA8IGVudGl0eS5fZmlybSkpe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59OyIsInZhciBjb250YWluZXJDb21wb25lbnQgPSByZXF1aXJlKCcuL2NvbnRhaW5lckNvbXBvbmVudCcpLFxuICAgIHNjaGVkdWxlID0gcmVxdWlyZSgnLi9zY2hlZHVsZScpLFxuICAgIGZhbmN5UHJvcHMgPSByZXF1aXJlKCcuL2ZhbmN5UHJvcHMnKSxcbiAgICBtYXRjaERvbUhhbmRsZXJOYW1lID0gL14oKD86ZWxcXC4pPykoW14uIF0rKSg/OlxcLihjYXB0dXJlKSk/JC8sXG4gICAgR0VORVJJQyA9ICdfZ2VuZXJpYyc7XG5cbmZ1bmN0aW9uIGNyZWF0ZVByb3BlcnRpZXMoZmFzdG4sIGNvbXBvbmVudCwgc2V0dGluZ3Mpe1xuICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcbiAgICAgICAgdmFyIHNldHRpbmcgPSBzZXR0aW5nc1trZXldO1xuXG4gICAgICAgIGlmKHR5cGVvZiBzZXR0aW5nID09PSAnZnVuY3Rpb24nICYmICFmYXN0bi5pc1Byb3BlcnR5KHNldHRpbmcpICYmICFmYXN0bi5pc0JpbmRpbmcoc2V0dGluZykpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb21wb25lbnQuYWRkRG9tUHJvcGVydHkoa2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHRyYWNrS2V5RXZlbnRzKGNvbXBvbmVudCwgZWxlbWVudCwgZXZlbnQpe1xuICAgIGlmKCdfbGFzdFN0YXRlcycgaW4gY29tcG9uZW50ICYmICdjaGFyQ29kZScgaW4gZXZlbnQpe1xuICAgICAgICBjb21wb25lbnQuX2xhc3RTdGF0ZXMudW5zaGlmdChlbGVtZW50LnZhbHVlKTtcbiAgICAgICAgY29tcG9uZW50Ll9sYXN0U3RhdGVzLnBvcCgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gYWRkRG9tSGFuZGxlcihjb21wb25lbnQsIGVsZW1lbnQsIGhhbmRsZXJOYW1lLCBldmVudE5hbWUsIGNhcHR1cmUpe1xuICAgIHZhciBldmVudFBhcnRzID0gaGFuZGxlck5hbWUuc3BsaXQoJy4nKTtcblxuICAgIGlmKGV2ZW50UGFydHNbMF0gPT09ICdvbicpe1xuICAgICAgICBldmVudFBhcnRzLnNoaWZ0KCk7XG4gICAgfVxuXG4gICAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihldmVudCl7XG4gICAgICAgICAgICB0cmFja0tleUV2ZW50cyhjb21wb25lbnQsIGVsZW1lbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIGNvbXBvbmVudC5lbWl0KGhhbmRsZXJOYW1lLCBldmVudCwgY29tcG9uZW50LnNjb3BlKCkpO1xuICAgICAgICB9O1xuXG4gICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlciwgY2FwdHVyZSk7XG5cbiAgICBjb21wb25lbnQub24oJ2Rlc3Ryb3knLCBmdW5jdGlvbigpe1xuICAgICAgICBlbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyLCBjYXB0dXJlKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gYWRkRG9tSGFuZGxlcnMoY29tcG9uZW50LCBlbGVtZW50LCBldmVudE5hbWVzKXtcbiAgICB2YXIgZXZlbnRzID0gZXZlbnROYW1lcy5zcGxpdCgnICcpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGV2ZW50cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHZhciBldmVudE5hbWUgPSBldmVudHNbaV0sXG4gICAgICAgICAgICBtYXRjaCA9IGV2ZW50TmFtZS5tYXRjaChtYXRjaERvbUhhbmRsZXJOYW1lKTtcblxuICAgICAgICBpZighbWF0Y2gpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihtYXRjaFsxXSB8fCAnb24nICsgbWF0Y2hbMl0gaW4gZWxlbWVudCl7XG4gICAgICAgICAgICBhZGREb21IYW5kbGVyKGNvbXBvbmVudCwgZWxlbWVudCwgZXZlbnROYW1lcywgbWF0Y2hbMl0sIG1hdGNoWzNdKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gYWRkQXV0b0hhbmRsZXIoY29tcG9uZW50LCBlbGVtZW50LCBrZXksIHNldHRpbmdzKXtcbiAgICBpZighc2V0dGluZ3Nba2V5XSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgYXV0b0V2ZW50ID0gc2V0dGluZ3Nba2V5XS5zcGxpdCgnOicpLFxuICAgICAgICBldmVudE5hbWUgPSBrZXkuc2xpY2UoMik7XG5cbiAgICBkZWxldGUgc2V0dGluZ3Nba2V5XTtcblxuICAgIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oZXZlbnQpe1xuICAgICAgICB2YXIgZmFuY3lQcm9wID0gZmFuY3lQcm9wc1thdXRvRXZlbnRbMV1dLFxuICAgICAgICAgICAgdmFsdWUgPSBmYW5jeVByb3AgPyBmYW5jeVByb3AoY29tcG9uZW50LCBlbGVtZW50KSA6IGVsZW1lbnRbYXV0b0V2ZW50WzFdXTtcblxuICAgICAgICB0cmFja0tleUV2ZW50cyhjb21wb25lbnQsIGVsZW1lbnQsIGV2ZW50KTtcblxuICAgICAgICBjb21wb25lbnRbYXV0b0V2ZW50WzBdXSh2YWx1ZSk7XG4gICAgfTtcblxuICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGhhbmRsZXIpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdkZXN0cm95JywgZnVuY3Rpb24oKXtcbiAgICAgICAgZWxlbWVudC5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlcik7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZERvbVByb3BlcnR5KGZhc3RuLCBrZXksIHByb3BlcnR5KXtcbiAgICB2YXIgY29tcG9uZW50ID0gdGhpcyxcbiAgICAgICAgdGltZW91dDtcblxuICAgIHByb3BlcnR5ID0gcHJvcGVydHkgfHwgY29tcG9uZW50W2tleV0gfHwgZmFzdG4ucHJvcGVydHkoKTtcbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkoa2V5LCBwcm9wZXJ0eSk7XG5cbiAgICBmdW5jdGlvbiB1cGRhdGUoKXtcblxuICAgICAgICB2YXIgZWxlbWVudCA9IGNvbXBvbmVudC5nZXRQcm9wZXJ0eUVsZW1lbnQoa2V5KSxcbiAgICAgICAgICAgIHZhbHVlID0gcHJvcGVydHkoKTtcblxuICAgICAgICBpZighZWxlbWVudCB8fCBjb21wb25lbnQuZGVzdHJveWVkKCkpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoXG4gICAgICAgICAgICBrZXkgPT09ICd2YWx1ZScgJiZcbiAgICAgICAgICAgIGNvbXBvbmVudC5fbGFzdFN0YXRlcyAmJlxuICAgICAgICAgICAgfmNvbXBvbmVudC5fbGFzdFN0YXRlcy5pbmRleE9mKHZhbHVlKVxuICAgICAgICApe1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICAgICAgdGltZW91dCA9IHNldFRpbWVvdXQodXBkYXRlLCA1MCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaXNQcm9wZXJ0eSA9IGtleSBpbiBlbGVtZW50IHx8ICEoJ2dldEF0dHJpYnV0ZScgaW4gZWxlbWVudCksXG4gICAgICAgICAgICBmYW5jeVByb3AgPSBjb21wb25lbnQuX2ZhbmN5UHJvcHMgJiYgY29tcG9uZW50Ll9mYW5jeVByb3BzKGtleSkgfHwgZmFuY3lQcm9wc1trZXldLFxuICAgICAgICAgICAgcHJldmlvdXMgPSBmYW5jeVByb3AgPyBmYW5jeVByb3AoY29tcG9uZW50LCBlbGVtZW50KSA6IGlzUHJvcGVydHkgPyBlbGVtZW50W2tleV0gOiBlbGVtZW50LmdldEF0dHJpYnV0ZShrZXkpO1xuXG4gICAgICAgIGlmKCFmYW5jeVByb3AgJiYgIWlzUHJvcGVydHkgJiYgdmFsdWUgPT0gbnVsbCl7XG4gICAgICAgICAgICB2YWx1ZSA9ICcnO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYodmFsdWUgIT09IHByZXZpb3VzKXtcbiAgICAgICAgICAgIGlmKGZhbmN5UHJvcCl7XG4gICAgICAgICAgICAgICAgZmFuY3lQcm9wKGNvbXBvbmVudCwgZWxlbWVudCwgdmFsdWUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoaXNQcm9wZXJ0eSl7XG4gICAgICAgICAgICAgICAgZWxlbWVudFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZih0eXBlb2YgdmFsdWUgIT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgICAgICAgICAgZWxlbWVudC5zZXRBdHRyaWJ1dGUoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcm9wZXJ0eS51cGRhdGVyKHVwZGF0ZSk7XG59XG5cbmZ1bmN0aW9uIG9uUmVuZGVyKCl7XG4gICAgdmFyIGNvbXBvbmVudCA9IHRoaXMsXG4gICAgICAgIGVsZW1lbnQ7XG5cbiAgICBmb3IodmFyIGtleSBpbiBjb21wb25lbnQuX3NldHRpbmdzKXtcbiAgICAgICAgZWxlbWVudCA9IGNvbXBvbmVudC5nZXRFdmVudEVsZW1lbnQoa2V5KTtcbiAgICAgICAgaWYoa2V5LnNsaWNlKDAsMikgPT09ICdvbicgJiYga2V5IGluIGVsZW1lbnQpe1xuICAgICAgICAgICAgYWRkQXV0b0hhbmRsZXIoY29tcG9uZW50LCBlbGVtZW50LCBrZXksIGNvbXBvbmVudC5fc2V0dGluZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZm9yKHZhciBldmVudEtleSBpbiBjb21wb25lbnQuX2V2ZW50cyl7XG4gICAgICAgIGVsZW1lbnQgPSBjb21wb25lbnQuZ2V0RXZlbnRFbGVtZW50KGtleSk7XG4gICAgICAgIGFkZERvbUhhbmRsZXJzKGNvbXBvbmVudCwgZWxlbWVudCwgZXZlbnRLZXkpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyKCl7XG4gICAgdGhpcy5lbGVtZW50ID0gdGhpcy5jcmVhdGVFbGVtZW50KHRoaXMuX3NldHRpbmdzLnRhZ05hbWUgfHwgdGhpcy5fdGFnTmFtZSk7XG5cbiAgICBpZigndmFsdWUnIGluIHRoaXMuZWxlbWVudCl7XG4gICAgICAgIHRoaXMuX2xhc3RTdGF0ZXMgPSBuZXcgQXJyYXkoMik7XG4gICAgfVxuXG4gICAgdGhpcy5lbWl0KCdyZW5kZXInKTtcblxuICAgIHJldHVybiB0aGlzO1xufTtcblxuZnVuY3Rpb24gZ2VuZXJpY0NvbXBvbmVudChmYXN0biwgY29tcG9uZW50LCB0eXBlLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuICAgIGlmKGNvbXBvbmVudC5pcyh0eXBlKSl7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfVxuXG4gICAgaWYodHlwZSA9PT0gR0VORVJJQyl7XG4gICAgICAgIGNvbXBvbmVudC5fdGFnTmFtZSA9IGNvbXBvbmVudC5fdGFnTmFtZSB8fCAnZGl2JztcbiAgICB9ZWxzZXtcbiAgICAgICAgY29tcG9uZW50Ll90YWdOYW1lID0gdHlwZTtcbiAgICB9XG5cbiAgICBpZihjb21wb25lbnQuaXMoR0VORVJJQykpe1xuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH1cblxuICAgIGNvbXBvbmVudC5leHRlbmQoJ19jb250YWluZXInLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xuXG4gICAgY29tcG9uZW50LmFkZERvbVByb3BlcnR5ID0gYWRkRG9tUHJvcGVydHkuYmluZChjb21wb25lbnQsIGZhc3RuKTtcbiAgICBjb21wb25lbnQuZ2V0RXZlbnRFbGVtZW50ID0gY29tcG9uZW50LmdldENvbnRhaW5lckVsZW1lbnQ7XG4gICAgY29tcG9uZW50LmdldFByb3BlcnR5RWxlbWVudCA9IGNvbXBvbmVudC5nZXRDb250YWluZXJFbGVtZW50O1xuICAgIGNvbXBvbmVudC51cGRhdGVQcm9wZXJ0eSA9IGdlbmVyaWNDb21wb25lbnQudXBkYXRlUHJvcGVydHk7XG4gICAgY29tcG9uZW50LmNyZWF0ZUVsZW1lbnQgPSBnZW5lcmljQ29tcG9uZW50LmNyZWF0ZUVsZW1lbnQ7XG5cbiAgICBjcmVhdGVQcm9wZXJ0aWVzKGZhc3RuLCBjb21wb25lbnQsIHNldHRpbmdzKTtcblxuICAgIGNvbXBvbmVudC5yZW5kZXIgPSByZW5kZXIuYmluZChjb21wb25lbnQpO1xuXG4gICAgY29tcG9uZW50Lm9uKCdyZW5kZXInLCBvblJlbmRlcik7XG5cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuXG5nZW5lcmljQ29tcG9uZW50LnVwZGF0ZVByb3BlcnR5ID0gZnVuY3Rpb24oY29tcG9uZW50LCBwcm9wZXJ0eSwgdXBkYXRlKXtcbiAgICBpZih0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnICYmIGRvY3VtZW50LmNvbnRhaW5zKGNvbXBvbmVudC5lbGVtZW50KSl7XG4gICAgICAgIHNjaGVkdWxlKHByb3BlcnR5LCB1cGRhdGUpO1xuICAgIH1lbHNle1xuICAgICAgICB1cGRhdGUoKTtcbiAgICB9XG59O1xuXG5nZW5lcmljQ29tcG9uZW50LmNyZWF0ZUVsZW1lbnQgPSBmdW5jdGlvbih0YWdOYW1lKXtcbiAgICBpZih0YWdOYW1lIGluc3RhbmNlb2YgTm9kZSl7XG4gICAgICAgIHJldHVybiB0YWdOYW1lO1xuICAgIH1cbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCh0YWdOYW1lKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZ2VuZXJpY0NvbXBvbmVudDsiLCJ2YXIgY3JlYXRlUHJvcGVydHkgPSByZXF1aXJlKCcuL3Byb3BlcnR5JyksXG4gICAgY3JlYXRlQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpLFxuICAgIEJhc2VDb21wb25lbnQgPSByZXF1aXJlKCcuL2Jhc2VDb21wb25lbnQnKSxcbiAgICBjcmVsID0gcmVxdWlyZSgnY3JlbCcpLFxuICAgIEVudGkgPSByZXF1aXJlKCdlbnRpJyksXG4gICAgb2JqZWN0QXNzaWduID0gcmVxdWlyZSgnb2JqZWN0LWFzc2lnbicpLFxuICAgIGlzID0gcmVxdWlyZSgnLi9pcycpO1xuXG5mdW5jdGlvbiBpbmZsYXRlUHJvcGVydGllcyhjb21wb25lbnQsIHNldHRpbmdzKXtcbiAgICBmb3IodmFyIGtleSBpbiBzZXR0aW5ncyl7XG4gICAgICAgIHZhciBzZXR0aW5nID0gc2V0dGluZ3Nba2V5XSxcbiAgICAgICAgICAgIHByb3BlcnR5ID0gY29tcG9uZW50W2tleV07XG5cbiAgICAgICAgaWYoaXMucHJvcGVydHkoc2V0dGluZ3Nba2V5XSkpe1xuXG4gICAgICAgICAgICBpZihpcy5wcm9wZXJ0eShwcm9wZXJ0eSkpe1xuICAgICAgICAgICAgICAgIHByb3BlcnR5LmRlc3Ryb3koKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0dGluZy5hZGRUbyhjb21wb25lbnQsIGtleSk7XG5cbiAgICAgICAgfWVsc2UgaWYoaXMucHJvcGVydHkocHJvcGVydHkpKXtcblxuICAgICAgICAgICAgaWYoaXMuYmluZGluZyhzZXR0aW5nKSl7XG4gICAgICAgICAgICAgICAgcHJvcGVydHkuYmluZGluZyhzZXR0aW5nKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHByb3BlcnR5KHNldHRpbmcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9wZXJ0eS5hZGRUbyhjb21wb25lbnQsIGtleSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRXhwZWN0ZWRDb21wb25lbnRzKGNvbXBvbmVudHMsIGNvbXBvbmVudE5hbWUsIGV4cGVjdGVkQ29tcG9uZW50cyl7XG4gICAgZXhwZWN0ZWRDb21wb25lbnRzID0gZXhwZWN0ZWRDb21wb25lbnRzLmZpbHRlcihmdW5jdGlvbihjb21wb25lbnROYW1lKXtcbiAgICAgICAgcmV0dXJuICEoY29tcG9uZW50TmFtZSBpbiBjb21wb25lbnRzKTtcbiAgICB9KTtcblxuICAgIGlmKGV4cGVjdGVkQ29tcG9uZW50cy5sZW5ndGgpe1xuICAgICAgICBjb25zb2xlLndhcm4oW1xuICAgICAgICAgICAgJ2Zhc3RuKFwiJyArIGNvbXBvbmVudE5hbWUgKyAnXCIpIHVzZXMgc29tZSBjb21wb25lbnRzIHRoYXQgaGF2ZSBub3QgYmVlbiByZWdpc3RlcmVkIHdpdGggZmFzdG4nLFxuICAgICAgICAgICAgJ0V4cGVjdGVkIGNvbnBvbmVudCBjb25zdHJ1Y3RvcnM6ICcgKyBleHBlY3RlZENvbXBvbmVudHMuam9pbignLCAnKVxuICAgICAgICBdLmpvaW4oJ1xcblxcbicpKTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oY29tcG9uZW50cywgZGVidWcpe1xuXG4gICAgaWYoIWNvbXBvbmVudHMgfHwgdHlwZW9mIGNvbXBvbmVudHMgIT09ICdvYmplY3QnKXtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdmYXN0biBtdXN0IGJlIGluaXRpYWxpc2VkIHdpdGggYSBjb21wb25lbnRzIG9iamVjdCcpO1xuICAgIH1cblxuICAgIGNvbXBvbmVudHMuX2NvbnRhaW5lciA9IGNvbXBvbmVudHMuX2NvbnRhaW5lciB8fCByZXF1aXJlKCcuL2NvbnRhaW5lckNvbXBvbmVudCcpO1xuXG4gICAgZnVuY3Rpb24gZmFzdG4odHlwZSl7XG5cbiAgICAgICAgdmFyIGFyZ3MgPSBbXTtcbiAgICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBhcmdzW2ldID0gYXJndW1lbnRzW2ldO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHNldHRpbmdzID0gYXJnc1sxXSxcbiAgICAgICAgICAgIGNoaWxkcmVuSW5kZXggPSAyLFxuICAgICAgICAgICAgc2V0dGluZ3NDaGlsZCA9IGZhc3RuLnRvQ29tcG9uZW50KGFyZ3NbMV0pO1xuXG4gICAgICAgIGlmKEFycmF5LmlzQXJyYXkoYXJnc1sxXSkgfHwgc2V0dGluZ3NDaGlsZCB8fCAhYXJnc1sxXSl7XG4gICAgICAgICAgICBpZihhcmdzLmxlbmd0aCA+IDEpe1xuICAgICAgICAgICAgICAgIGFyZ3NbMV0gPSBzZXR0aW5nc0NoaWxkIHx8IGFyZ3NbMV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGlsZHJlbkluZGV4LS07XG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBzZXR0aW5ncyA9IG9iamVjdEFzc2lnbih7fSwgc2V0dGluZ3MgfHwge30pO1xuXG4gICAgICAgIHZhciB0eXBlcyA9IHR5cGVvZiB0eXBlID09PSAnc3RyaW5nJyA/IHR5cGUuc3BsaXQoJzonKSA6IEFycmF5LmlzQXJyYXkodHlwZSkgPyB0eXBlIDogW3R5cGVdLFxuICAgICAgICAgICAgYmFzZVR5cGUsXG4gICAgICAgICAgICBjaGlsZHJlbiA9IGFyZ3Muc2xpY2UoY2hpbGRyZW5JbmRleCksXG4gICAgICAgICAgICBjb21wb25lbnQgPSBmYXN0bi5iYXNlKHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbik7XG5cbiAgICAgICAgd2hpbGUoYmFzZVR5cGUgPSB0eXBlcy5zaGlmdCgpKXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5leHRlbmQoYmFzZVR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgICAgIH1cblxuICAgICAgICBjb21wb25lbnQuX3Byb3BlcnRpZXMgPSB7fTtcblxuICAgICAgICBpbmZsYXRlUHJvcGVydGllcyhjb21wb25lbnQsIHNldHRpbmdzKTtcblxuICAgICAgICByZXR1cm4gY29tcG9uZW50O1xuICAgIH1cblxuICAgIGZhc3RuLnRvQ29tcG9uZW50ID0gZnVuY3Rpb24oY29tcG9uZW50KXtcbiAgICAgICAgaWYoY29tcG9uZW50ID09IG51bGwpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmKGlzLmNvbXBvbmVudChjb21wb25lbnQpKXtcbiAgICAgICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYodHlwZW9mIGNvbXBvbmVudCAhPT0gJ29iamVjdCcgfHwgY29tcG9uZW50IGluc3RhbmNlb2YgRGF0ZSl7XG4gICAgICAgICAgICByZXR1cm4gZmFzdG4oJ3RleHQnLCB7IHRleHQ6IGNvbXBvbmVudCB9LCBjb21wb25lbnQpO1xuICAgICAgICB9XG4gICAgICAgIGlmKGNyZWwuaXNFbGVtZW50KGNvbXBvbmVudCkpe1xuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKGNvbXBvbmVudCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoY3JlbC5pc05vZGUoY29tcG9uZW50KSl7XG4gICAgICAgICAgICByZXR1cm4gZmFzdG4oJ3RleHQnLCB7IHRleHQ6IGNvbXBvbmVudCB9LCBjb21wb25lbnQudGV4dENvbnRlbnQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGZhc3RuLmRlYnVnID0gZGVidWc7XG4gICAgZmFzdG4ucHJvcGVydHkgPSBjcmVhdGVQcm9wZXJ0eS5iaW5kKGZhc3RuKTtcbiAgICBmYXN0bi5iaW5kaW5nID0gY3JlYXRlQmluZGluZyhmYXN0bik7XG4gICAgZmFzdG4uaXNDb21wb25lbnQgPSBpcy5jb21wb25lbnQ7XG4gICAgZmFzdG4uaXNCaW5kaW5nID0gaXMuYmluZGluZztcbiAgICBmYXN0bi5pc0RlZmF1bHRCaW5kaW5nID0gaXMuZGVmYXVsdEJpbmRpbmc7XG4gICAgZmFzdG4uaXNCaW5kaW5nT2JqZWN0ID0gaXMuYmluZGluZ09iamVjdDtcbiAgICBmYXN0bi5pc1Byb3BlcnR5ID0gaXMucHJvcGVydHk7XG4gICAgZmFzdG4uY29tcG9uZW50cyA9IGNvbXBvbmVudHM7XG4gICAgZmFzdG4uTW9kZWwgPSBFbnRpO1xuICAgIGZhc3RuLmlzTW9kZWwgPSBFbnRpLmlzRW50aS5iaW5kKEVudGkpO1xuXG4gICAgZmFzdG4uYmFzZSA9IGZ1bmN0aW9uKHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgICAgIHJldHVybiBuZXcgQmFzZUNvbXBvbmVudChmYXN0biwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKTtcbiAgICB9O1xuXG4gICAgZm9yKHZhciBrZXkgaW4gY29tcG9uZW50cyl7XG4gICAgICAgIHZhciBjb21wb25lbnRDb25zdHJ1Y3RvciA9IGNvbXBvbmVudHNba2V5XTtcblxuICAgICAgICBpZihjb21wb25lbnRDb25zdHJ1Y3Rvci5leHBlY3RlZENvbXBvbmVudHMpe1xuICAgICAgICAgICAgdmFsaWRhdGVFeHBlY3RlZENvbXBvbmVudHMoY29tcG9uZW50cywga2V5LCBjb21wb25lbnRDb25zdHJ1Y3Rvci5leHBlY3RlZENvbXBvbmVudHMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhc3RuO1xufTtcbiIsInZhciBGVU5DVElPTiA9ICdmdW5jdGlvbicsXG4gICAgT0JKRUNUID0gJ29iamVjdCcsXG4gICAgRkFTVE5CSU5ESU5HID0gJ19mYXN0bl9iaW5kaW5nJyxcbiAgICBGQVNUTlBST1BFUlRZID0gJ19mYXN0bl9wcm9wZXJ0eScsXG4gICAgRkFTVE5DT01QT05FTlQgPSAnX2Zhc3RuX2NvbXBvbmVudCcsXG4gICAgREVGQVVMVEJJTkRJTkcgPSAnX2RlZmF1bHRfYmluZGluZyc7XG5cbmZ1bmN0aW9uIGlzQ29tcG9uZW50KHRoaW5nKXtcbiAgICByZXR1cm4gdGhpbmcgJiYgdHlwZW9mIHRoaW5nID09PSBPQkpFQ1QgJiYgRkFTVE5DT01QT05FTlQgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzQmluZGluZ09iamVjdCh0aGluZyl7XG4gICAgcmV0dXJuIHRoaW5nICYmIHR5cGVvZiB0aGluZyA9PT0gT0JKRUNUICYmIEZBU1ROQklORElORyBpbiB0aGluZztcbn1cblxuZnVuY3Rpb24gaXNCaW5kaW5nKHRoaW5nKXtcbiAgICByZXR1cm4gdHlwZW9mIHRoaW5nID09PSBGVU5DVElPTiAmJiBGQVNUTkJJTkRJTkcgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzUHJvcGVydHkodGhpbmcpe1xuICAgIHJldHVybiB0eXBlb2YgdGhpbmcgPT09IEZVTkNUSU9OICYmIEZBU1ROUFJPUEVSVFkgaW4gdGhpbmc7XG59XG5cbmZ1bmN0aW9uIGlzRGVmYXVsdEJpbmRpbmcodGhpbmcpe1xuICAgIHJldHVybiB0eXBlb2YgdGhpbmcgPT09IEZVTkNUSU9OICYmIEZBU1ROQklORElORyBpbiB0aGluZyAmJiBERUZBVUxUQklORElORyBpbiB0aGluZztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgY29tcG9uZW50OiBpc0NvbXBvbmVudCxcbiAgICBiaW5kaW5nT2JqZWN0OiBpc0JpbmRpbmdPYmplY3QsXG4gICAgYmluZGluZzogaXNCaW5kaW5nLFxuICAgIGRlZmF1bHRCaW5kaW5nOiBpc0RlZmF1bHRCaW5kaW5nLFxuICAgIHByb3BlcnR5OiBpc1Byb3BlcnR5XG59OyIsInZhciBNdWx0aU1hcCA9IHJlcXVpcmUoJ211bHRpbWFwJyksXG4gICAgbWVyZ2UgPSByZXF1aXJlKCdmbGF0LW1lcmdlJyk7XG5cbnZhciByZXF1ZXN0SWRsZUNhbGxiYWNrID0gZ2xvYmFsLnJlcXVlc3RJZGxlQ2FsbGJhY2sgfHwgZ2xvYmFsLnJlcXVlc3RBbmltYXRpb25GcmFtZSB8fCBnbG9iYWwuc2V0VGltZW91dDtcblxuTXVsdGlNYXAuTWFwID0gTWFwO1xuXG5mdW5jdGlvbiBlYWNoKHZhbHVlLCBmbil7XG4gICAgaWYoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYoQXJyYXkuaXNBcnJheSh2YWx1ZSkpe1xuICAgICAgICBmb3IodmFyIGkgPSAwOyBpIDwgdmFsdWUubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgZm4odmFsdWVbaV0sIGkpXG4gICAgICAgIH1cbiAgICB9ZWxzZXtcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gdmFsdWUpe1xuICAgICAgICAgICAgZm4odmFsdWVba2V5XSwga2V5KTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24ga2V5Rm9yKG9iamVjdCwgdmFsdWUpe1xuICAgIGlmKCFvYmplY3QgfHwgdHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcpe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgaWYoQXJyYXkuaXNBcnJheShvYmplY3QpKXtcbiAgICAgICAgdmFyIGluZGV4ID0gb2JqZWN0LmluZGV4T2YodmFsdWUpO1xuICAgICAgICByZXR1cm4gaW5kZXggPj0wID8gaW5kZXggOiBmYWxzZTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGtleSBpbiBvYmplY3Qpe1xuICAgICAgICBpZihvYmplY3Rba2V5XSA9PT0gdmFsdWUpe1xuICAgICAgICAgICAgcmV0dXJuIGtleTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmYXN0biwgY29tcG9uZW50LCB0eXBlLCBzZXR0aW5ncywgY2hpbGRyZW4pe1xuXG4gICAgaWYoZmFzdG4uY29tcG9uZW50cy5fZ2VuZXJpYyl7XG4gICAgICAgIGNvbXBvbmVudC5leHRlbmQoJ19nZW5lcmljJywgc2V0dGluZ3MsIGNoaWxkcmVuKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgY29tcG9uZW50LmV4dGVuZCgnX2NvbnRhaW5lcicsIHNldHRpbmdzLCBjaGlsZHJlbik7XG4gICAgfVxuXG4gICAgaWYoISgndGVtcGxhdGUnIGluIHNldHRpbmdzKSl7XG4gICAgICAgIGNvbnNvbGUud2FybignTm8gXCJ0ZW1wbGF0ZVwiIGZ1bmN0aW9uIHdhcyBzZXQgZm9yIHRoaXMgdGVtcGxhdGVyIGNvbXBvbmVudCcpO1xuICAgIH1cblxuICAgIHZhciBpdGVtc01hcCA9IG5ldyBNdWx0aU1hcCgpLFxuICAgICAgICBkYXRhTWFwID0gbmV3IFdlYWtNYXAoKSxcbiAgICAgICAgbGFzdFRlbXBsYXRlLFxuICAgICAgICBleGlzdGluZ0l0ZW0gPSB7fTtcblxuICAgIHZhciBpbnNlcnRRdWV1ZSA9IFtdO1xuICAgIHZhciBpbnNlcnRpbmc7XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVPckNyZWF0ZUNoaWxkKHRlbXBsYXRlLCBpdGVtLCBrZXkpe1xuICAgICAgICB2YXIgY2hpbGQsXG4gICAgICAgICAgICBleGlzdGluZztcblxuICAgICAgICBpZihBcnJheS5pc0FycmF5KGl0ZW0pICYmIGl0ZW1bMF0gPT09IGV4aXN0aW5nSXRlbSl7XG4gICAgICAgICAgICBleGlzdGluZyA9IHRydWU7XG4gICAgICAgICAgICBjaGlsZCA9IGl0ZW1bMl07XG4gICAgICAgICAgICBpdGVtID0gaXRlbVsxXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjaGlsZE1vZGVsO1xuXG4gICAgICAgIGlmKCFleGlzdGluZyl7XG4gICAgICAgICAgICBjaGlsZE1vZGVsID0gbmV3IGZhc3RuLk1vZGVsKHtcbiAgICAgICAgICAgICAgICBpdGVtOiBpdGVtLFxuICAgICAgICAgICAgICAgIGtleToga2V5XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY2hpbGQgPSBmYXN0bi50b0NvbXBvbmVudCh0ZW1wbGF0ZShjaGlsZE1vZGVsLCBjb21wb25lbnQuc2NvcGUoKSkpO1xuICAgICAgICAgICAgaWYoIWNoaWxkKXtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGZhc3RuKCd0ZW1wbGF0ZScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hpbGQuX2xpc3RJdGVtID0gaXRlbTtcbiAgICAgICAgICAgIGNoaWxkLl90ZW1wbGF0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICBkYXRhTWFwLnNldChjaGlsZCwgY2hpbGRNb2RlbCk7XG4gICAgICAgICAgICBpdGVtc01hcC5zZXQoaXRlbSwgY2hpbGQpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGNoaWxkTW9kZWwgPSBkYXRhTWFwLmdldChjaGlsZCk7XG4gICAgICAgICAgICBjaGlsZE1vZGVsLnNldCgna2V5Jywga2V5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGZhc3RuLmlzQ29tcG9uZW50KGNoaWxkKSAmJiBjb21wb25lbnQuX3NldHRpbmdzLmF0dGFjaFRlbXBsYXRlcyAhPT0gZmFsc2Upe1xuICAgICAgICAgICAgY2hpbGQuYXR0YWNoKGNoaWxkTW9kZWwsIDIpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGluc2VydE5leHRJdGVtcyh0ZW1wbGF0ZSwgaW5zZXJ0aW9uRnJhbWVUaW1lKXtcbiAgICAgICAgaWYoaW5zZXJ0aW5nKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGluc2VydGluZyA9IHRydWU7XG4gICAgICAgIGNvbXBvbmVudC5lbWl0KCdpbnNlcnRpb25TdGFydCcsIGluc2VydFF1ZXVlLmxlbmd0aCk7XG5cbiAgICAgICAgaW5zZXJ0UXVldWUuc29ydChmdW5jdGlvbihhLCBiKXtcbiAgICAgICAgICAgIHJldHVybiBhWzJdIC0gYlsyXTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZnVuY3Rpb24gaW5zZXJ0TmV4dCgpe1xuICAgICAgICAgICAgdmFyIHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgICAgICAgIHdoaWxlKGluc2VydFF1ZXVlLmxlbmd0aCAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lIDwgaW5zZXJ0aW9uRnJhbWVUaW1lKSB7XG4gICAgICAgICAgICAgICAgdmFyIG5leHRJbnNlcnNpb24gPSBpbnNlcnRRdWV1ZS5zaGlmdCgpO1xuICAgICAgICAgICAgICAgIHZhciBjaGlsZCA9IHVwZGF0ZU9yQ3JlYXRlQ2hpbGQodGVtcGxhdGUsIG5leHRJbnNlcnNpb25bMF0sIG5leHRJbnNlcnNpb25bMV0pO1xuICAgICAgICAgICAgICAgIGNvbXBvbmVudC5pbnNlcnQoY2hpbGQsIG5leHRJbnNlcnNpb25bMl0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZighaW5zZXJ0UXVldWUubGVuZ3RoIHx8IGNvbXBvbmVudC5kZXN0cm95ZWQoKSl7XG4gICAgICAgICAgICAgICAgaW5zZXJ0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYoIWNvbXBvbmVudC5kZXN0cm95ZWQoKSl7XG4gICAgICAgICAgICAgICAgICAgIGNvbXBvbmVudC5lbWl0KCdpbnNlcnRpb25Db21wbGV0ZScpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlcXVlc3RJZGxlQ2FsbGJhY2soaW5zZXJ0TmV4dCk7XG4gICAgICAgIH1cblxuICAgICAgICBpbnNlcnROZXh0KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlSXRlbXMoKXtcbiAgICAgICAgaW5zZXJ0UXVldWUgPSBbXTtcblxuICAgICAgICB2YXIgdmFsdWUgPSBjb21wb25lbnQuaXRlbXMoKSxcbiAgICAgICAgICAgIHRlbXBsYXRlID0gY29tcG9uZW50LnRlbXBsYXRlKCksXG4gICAgICAgICAgICBlbXB0eVRlbXBsYXRlID0gY29tcG9uZW50LmVtcHR5VGVtcGxhdGUoKSxcbiAgICAgICAgICAgIGluc2VydGlvbkZyYW1lVGltZSA9IGNvbXBvbmVudC5pbnNlcnRpb25GcmFtZVRpbWUoKSB8fCBJbmZpbml0eSxcbiAgICAgICAgICAgIG5ld1RlbXBsYXRlID0gbGFzdFRlbXBsYXRlICE9PSB0ZW1wbGF0ZTtcblxuICAgICAgICB2YXIgY3VycmVudEl0ZW1zID0gbWVyZ2UodGVtcGxhdGUgPyB2YWx1ZSA6IFtdKTtcblxuICAgICAgICBpdGVtc01hcC5mb3JFYWNoKGZ1bmN0aW9uKGNoaWxkQ29tcG9uZW50LCBpdGVtKXtcbiAgICAgICAgICAgIHZhciBjdXJyZW50S2V5ID0ga2V5Rm9yKGN1cnJlbnRJdGVtcywgaXRlbSk7XG5cbiAgICAgICAgICAgIGlmKCFuZXdUZW1wbGF0ZSAmJiBjdXJyZW50S2V5ICE9PSBmYWxzZSl7XG4gICAgICAgICAgICAgICAgY3VycmVudEl0ZW1zW2N1cnJlbnRLZXldID0gW2V4aXN0aW5nSXRlbSwgaXRlbSwgY2hpbGRDb21wb25lbnRdO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgcmVtb3ZlQ29tcG9uZW50KGNoaWxkQ29tcG9uZW50KTtcbiAgICAgICAgICAgICAgICBpdGVtc01hcC5kZWxldGUoaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHZhciBpbmRleCA9IDA7XG4gICAgICAgIHZhciB0ZW1wbGF0ZUluZGV4ID0gMDtcblxuICAgICAgICBmdW5jdGlvbiB1cGRhdGVJdGVtKGl0ZW0sIGtleSl7XG4gICAgICAgICAgICB3aGlsZShpbmRleCA8IGNvbXBvbmVudC5fY2hpbGRyZW4ubGVuZ3RoICYmICFjb21wb25lbnQuX2NoaWxkcmVuW2luZGV4XS5fdGVtcGxhdGVkKXtcbiAgICAgICAgICAgICAgICBpbmRleCsrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpbnNlcnRRdWV1ZS5wdXNoKFtpdGVtLCBrZXksIGluZGV4ICsgdGVtcGxhdGVJbmRleF0pO1xuICAgICAgICAgICAgdGVtcGxhdGVJbmRleCsrO1xuICAgICAgICB9XG5cbiAgICAgICAgZWFjaChjdXJyZW50SXRlbXMsIHVwZGF0ZUl0ZW0pO1xuXG4gICAgICAgIHRlbXBsYXRlICYmIGluc2VydE5leHRJdGVtcyh0ZW1wbGF0ZSwgaW5zZXJ0aW9uRnJhbWVUaW1lKTtcblxuICAgICAgICBsYXN0VGVtcGxhdGUgPSB0ZW1wbGF0ZTtcblxuICAgICAgICBpZih0ZW1wbGF0ZUluZGV4ID09PSAwICYmIGVtcHR5VGVtcGxhdGUpe1xuICAgICAgICAgICAgdmFyIGNoaWxkID0gZmFzdG4udG9Db21wb25lbnQoZW1wdHlUZW1wbGF0ZShjb21wb25lbnQuc2NvcGUoKSkpO1xuICAgICAgICAgICAgaWYoIWNoaWxkKXtcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGZhc3RuKCd0ZW1wbGF0ZScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hpbGQuX3RlbXBsYXRlZCA9IHRydWU7XG5cbiAgICAgICAgICAgIGl0ZW1zTWFwLnNldCh7fSwgY2hpbGQpO1xuXG4gICAgICAgICAgICBjb21wb25lbnQuaW5zZXJ0KGNoaWxkKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbW92ZUNvbXBvbmVudChjaGlsZENvbXBvbmVudCl7XG4gICAgICAgIGNvbXBvbmVudC5yZW1vdmUoY2hpbGRDb21wb25lbnQpO1xuICAgICAgICBjaGlsZENvbXBvbmVudC5kZXN0cm95KCk7XG4gICAgfVxuXG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5KCdpbnNlcnRpb25GcmFtZVRpbWUnKTtcblxuICAgIGNvbXBvbmVudC5zZXRQcm9wZXJ0eSgnaXRlbXMnLFxuICAgICAgICBmYXN0bi5wcm9wZXJ0eShbXSwgc2V0dGluZ3MuaXRlbUNoYW5nZXMgfHwgJ3R5cGUga2V5cyBzaGFsbG93U3RydWN0dXJlJylcbiAgICAgICAgICAgIC5vbignY2hhbmdlJywgdXBkYXRlSXRlbXMpXG4gICAgKTtcblxuICAgIGNvbXBvbmVudC5zZXRQcm9wZXJ0eSgndGVtcGxhdGUnLFxuICAgICAgICBmYXN0bi5wcm9wZXJ0eSgpLm9uKCdjaGFuZ2UnLCB1cGRhdGVJdGVtcylcbiAgICApO1xuXG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5KCdlbXB0eVRlbXBsYXRlJyxcbiAgICAgICAgZmFzdG4ucHJvcGVydHkoKS5vbignY2hhbmdlJywgdXBkYXRlSXRlbXMpXG4gICAgKTtcblxuICAgIHJldHVybiBjb21wb25lbnQ7XG59OyIsInZhciBXaGF0Q2hhbmdlZCA9IHJlcXVpcmUoJ3doYXQtY2hhbmdlZCcpLFxuICAgIHNhbWUgPSByZXF1aXJlKCdzYW1lLXZhbHVlJyksXG4gICAgZmlybWVyID0gcmVxdWlyZSgnLi9maXJtZXInKSxcbiAgICBmdW5jdGlvbkVtaXR0ZXIgPSByZXF1aXJlKCdmdW5jdGlvbi1lbWl0dGVyJyksXG4gICAgc2V0UHJvdG90eXBlT2YgPSByZXF1aXJlKCdzZXRwcm90b3R5cGVvZicpO1xuXG52YXIgcHJvcGVydHlQcm90byA9IE9iamVjdC5jcmVhdGUoZnVuY3Rpb25FbWl0dGVyKTtcblxucHJvcGVydHlQcm90by5fZmFzdG5fcHJvcGVydHkgPSB0cnVlO1xucHJvcGVydHlQcm90by5fZmlybSA9IDE7XG5cbmZ1bmN0aW9uIHByb3BlcnR5VGVtcGxhdGUodmFsdWUpe1xuICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuYmluZGluZyAmJiB0aGlzLmJpbmRpbmcoKSB8fCB0aGlzLnByb3BlcnR5Ll92YWx1ZTtcbiAgICB9XG5cbiAgICBpZighdGhpcy5kZXN0cm95ZWQpe1xuICAgICAgICBpZih0aGlzLmJpbmRpbmcpe1xuICAgICAgICAgICAgdGhpcy5iaW5kaW5nKHZhbHVlKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy52YWx1ZVVwZGF0ZSh2YWx1ZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG59XG5cbmZ1bmN0aW9uIGNoYW5nZUNoZWNrZXIoY3VycmVudCwgY2hhbmdlcyl7XG4gICAgaWYoY2hhbmdlcyl7XG4gICAgICAgIHZhciBjaGFuZ2VzID0gbmV3IFdoYXRDaGFuZ2VkKGN1cnJlbnQsIGNoYW5nZXMpO1xuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgICAgICByZXR1cm4gY2hhbmdlcy51cGRhdGUodmFsdWUpLmFueTtcbiAgICAgICAgfTtcbiAgICB9ZWxzZXtcbiAgICAgICAgdmFyIGxhc3RWYWx1ZSA9IGN1cnJlbnQ7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbihuZXdWYWx1ZSl7XG4gICAgICAgICAgICBpZighc2FtZShsYXN0VmFsdWUsIG5ld1ZhbHVlKSl7XG4gICAgICAgICAgICAgICAgbGFzdFZhbHVlID0gbmV3VmFsdWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxufVxuXG5cbmZ1bmN0aW9uIHByb3BlcnR5QmluZGluZyhuZXdCaW5kaW5nKXtcbiAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0aGlzLmJpbmRpbmc7XG4gICAgfVxuXG4gICAgaWYoIXRoaXMuZmFzdG4uaXNCaW5kaW5nKG5ld0JpbmRpbmcpKXtcbiAgICAgICAgbmV3QmluZGluZyA9IHRoaXMuZmFzdG4uYmluZGluZyhuZXdCaW5kaW5nKTtcbiAgICB9XG5cbiAgICBpZihuZXdCaW5kaW5nID09PSB0aGlzLmJpbmRpbmcpe1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0eTtcbiAgICB9XG5cbiAgICBpZih0aGlzLmJpbmRpbmcpe1xuICAgICAgICB0aGlzLmJpbmRpbmcucmVtb3ZlTGlzdGVuZXIoJ2NoYW5nZScsIHRoaXMudmFsdWVVcGRhdGUpO1xuICAgIH1cblxuICAgIHRoaXMuYmluZGluZyA9IG5ld0JpbmRpbmc7XG5cbiAgICBpZih0aGlzLm1vZGVsKXtcbiAgICAgICAgdGhpcy5wcm9wZXJ0eS5hdHRhY2godGhpcy5tb2RlbCwgdGhpcy5wcm9wZXJ0eS5fZmlybSk7XG4gICAgfVxuXG4gICAgdGhpcy5iaW5kaW5nLm9uKCdjaGFuZ2UnLCB0aGlzLnZhbHVlVXBkYXRlKTtcbiAgICB0aGlzLnZhbHVlVXBkYXRlKHRoaXMuYmluZGluZygpKTtcblxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gYXR0YWNoUHJvcGVydHkob2JqZWN0LCBmaXJtKXtcbiAgICBpZihmaXJtZXIodGhpcy5wcm9wZXJ0eSwgZmlybSkpe1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9wZXJ0eTtcbiAgICB9XG5cbiAgICB0aGlzLnByb3BlcnR5Ll9maXJtID0gZmlybTtcblxuICAgIGlmKCEob2JqZWN0IGluc3RhbmNlb2YgT2JqZWN0KSl7XG4gICAgICAgIG9iamVjdCA9IHt9O1xuICAgIH1cblxuICAgIGlmKHRoaXMuYmluZGluZyl7XG4gICAgICAgIHRoaXMubW9kZWwgPSBvYmplY3Q7XG4gICAgICAgIHRoaXMuYmluZGluZy5hdHRhY2gob2JqZWN0LCAxKTtcbiAgICB9XG5cbiAgICBpZih0aGlzLnByb3BlcnR5Ll9ldmVudHMgJiYgJ2F0dGFjaCcgaW4gdGhpcy5wcm9wZXJ0eS5fZXZlbnRzKXtcbiAgICAgICAgdGhpcy5wcm9wZXJ0eS5lbWl0KCdhdHRhY2gnLCBvYmplY3QsIDEpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gZGV0YWNoUHJvcGVydHkoZmlybSl7XG4gICAgaWYoZmlybWVyKHRoaXMucHJvcGVydHksIGZpcm0pKXtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG4gICAgfVxuXG4gICAgaWYodGhpcy5iaW5kaW5nKXtcbiAgICAgICAgdGhpcy5iaW5kaW5nLnJlbW92ZUxpc3RlbmVyKCdjaGFuZ2UnLCB0aGlzLnZhbHVlVXBkYXRlKTtcbiAgICAgICAgdGhpcy5iaW5kaW5nLmRldGFjaCgxKTtcbiAgICAgICAgdGhpcy5tb2RlbCA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYodGhpcy5wcm9wZXJ0eS5fZXZlbnRzICYmICdkZXRhY2gnIGluIHRoaXMucHJvcGVydHkuX2V2ZW50cyl7XG4gICAgICAgIHRoaXMucHJvcGVydHkuZW1pdCgnZGV0YWNoJywgMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG59O1xuXG5mdW5jdGlvbiB1cGRhdGVQcm9wZXJ0eSgpe1xuICAgIGlmKCF0aGlzLmRlc3Ryb3llZCl7XG5cbiAgICAgICAgaWYodGhpcy5wcm9wZXJ0eS5fdXBkYXRlKXtcbiAgICAgICAgICAgIHRoaXMucHJvcGVydHkuX3VwZGF0ZSh0aGlzLnByb3BlcnR5Ll92YWx1ZSwgdGhpcy5wcm9wZXJ0eSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnByb3BlcnR5LmVtaXQoJ3VwZGF0ZScsIHRoaXMucHJvcGVydHkuX3ZhbHVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG59O1xuXG5mdW5jdGlvbiBwcm9wZXJ0eVVwZGF0ZXIoZm4pe1xuICAgIGlmKCFhcmd1bWVudHMubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMucHJvcGVydHkuX3VwZGF0ZTtcbiAgICB9XG4gICAgdGhpcy5wcm9wZXJ0eS5fdXBkYXRlID0gZm47XG4gICAgcmV0dXJuIHRoaXMucHJvcGVydHk7XG59O1xuXG5mdW5jdGlvbiBkZXN0cm95UHJvcGVydHkoKXtcbiAgICBpZighdGhpcy5kZXN0cm95ZWQpe1xuICAgICAgICB0aGlzLmRlc3Ryb3llZCA9IHRydWU7XG5cbiAgICAgICAgdGhpcy5wcm9wZXJ0eVxuICAgICAgICAgICAgLnJlbW92ZUFsbExpc3RlbmVycygnY2hhbmdlJylcbiAgICAgICAgICAgIC5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3VwZGF0ZScpXG4gICAgICAgICAgICAucmVtb3ZlQWxsTGlzdGVuZXJzKCdhdHRhY2gnKTtcblxuICAgICAgICB0aGlzLnByb3BlcnR5LmVtaXQoJ2Rlc3Ryb3knKTtcbiAgICAgICAgdGhpcy5wcm9wZXJ0eS5kZXRhY2goKTtcbiAgICAgICAgaWYodGhpcy5iaW5kaW5nKXtcbiAgICAgICAgICAgIHRoaXMuYmluZGluZy5kZXN0cm95KHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gcHJvcGVydHlEZXN0cm95ZWQoKXtcbiAgICByZXR1cm4gdGhpcy5kZXN0cm95ZWQ7XG59O1xuXG5mdW5jdGlvbiBhZGRQcm9wZXJ0eVRvKGNvbXBvbmVudCwga2V5KXtcbiAgICBjb21wb25lbnQuc2V0UHJvcGVydHkoa2V5LCB0aGlzLnByb3BlcnR5KTtcblxuICAgIHJldHVybiB0aGlzLnByb3BlcnR5O1xufTtcblxuZnVuY3Rpb24gY3JlYXRlUHJvcGVydHkoY3VycmVudFZhbHVlLCBjaGFuZ2VzLCB1cGRhdGVyKXtcbiAgICBpZih0eXBlb2YgY2hhbmdlcyA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHVwZGF0ZXIgPSBjaGFuZ2VzO1xuICAgICAgICBjaGFuZ2VzID0gbnVsbDtcbiAgICB9XG5cbiAgICB2YXIgcHJvcGVydHlTY29wZSA9IHtcbiAgICAgICAgICAgIGZhc3RuOiB0aGlzLFxuICAgICAgICAgICAgaGFzQ2hhbmdlZDogY2hhbmdlQ2hlY2tlcihjdXJyZW50VmFsdWUsIGNoYW5nZXMpXG4gICAgICAgIH0sXG4gICAgICAgIHByb3BlcnR5ID0gcHJvcGVydHlUZW1wbGF0ZS5iaW5kKHByb3BlcnR5U2NvcGUpO1xuXG4gICAgcHJvcGVydHlTY29wZS52YWx1ZVVwZGF0ZSA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgcHJvcGVydHkuX3ZhbHVlID0gdmFsdWU7XG4gICAgICAgIGlmKCFwcm9wZXJ0eVNjb3BlLmhhc0NoYW5nZWQodmFsdWUpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBwcm9wZXJ0eS5lbWl0KCdjaGFuZ2UnLCBwcm9wZXJ0eS5fdmFsdWUpO1xuICAgICAgICBwcm9wZXJ0eS51cGRhdGUoKTtcbiAgICB9O1xuXG4gICAgdmFyIHByb3BlcnR5ID0gcHJvcGVydHlTY29wZS5wcm9wZXJ0eSA9IHByb3BlcnR5VGVtcGxhdGUuYmluZChwcm9wZXJ0eVNjb3BlKTtcblxuICAgIHByb3BlcnR5Ll92YWx1ZSA9IGN1cnJlbnRWYWx1ZTtcbiAgICBwcm9wZXJ0eS5fdXBkYXRlID0gdXBkYXRlcjtcblxuICAgIHNldFByb3RvdHlwZU9mKHByb3BlcnR5LCBwcm9wZXJ0eVByb3RvKTtcblxuICAgIHByb3BlcnR5LmJpbmRpbmcgPSBwcm9wZXJ0eUJpbmRpbmcuYmluZChwcm9wZXJ0eVNjb3BlKTtcbiAgICBwcm9wZXJ0eS5hdHRhY2ggPSBhdHRhY2hQcm9wZXJ0eS5iaW5kKHByb3BlcnR5U2NvcGUpO1xuICAgIHByb3BlcnR5LmRldGFjaCA9IGRldGFjaFByb3BlcnR5LmJpbmQocHJvcGVydHlTY29wZSk7XG4gICAgcHJvcGVydHkudXBkYXRlID0gdXBkYXRlUHJvcGVydHkuYmluZChwcm9wZXJ0eVNjb3BlKTtcbiAgICBwcm9wZXJ0eS51cGRhdGVyID0gcHJvcGVydHlVcGRhdGVyLmJpbmQocHJvcGVydHlTY29wZSk7XG4gICAgcHJvcGVydHkuZGVzdHJveSA9IGRlc3Ryb3lQcm9wZXJ0eS5iaW5kKHByb3BlcnR5U2NvcGUpO1xuICAgIHByb3BlcnR5LmRlc3Ryb3llZCA9IHByb3BlcnR5RGVzdHJveWVkLmJpbmQocHJvcGVydHlTY29wZSk7XG4gICAgcHJvcGVydHkuYWRkVG8gPSBhZGRQcm9wZXJ0eVRvLmJpbmQocHJvcGVydHlTY29wZSk7XG5cbiAgICByZXR1cm4gcHJvcGVydHk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZVByb3BlcnR5OyIsInZhciB0b2RvID0gW10sXG4gICAgdG9kb0tleXMgPSBbXSxcbiAgICBzY2hlZHVsZWQsXG4gICAgdXBkYXRlcyA9IDA7XG5cbmZ1bmN0aW9uIHJ1bigpe1xuICAgIHZhciBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgd2hpbGUodG9kby5sZW5ndGggJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA8IDE2KXtcbiAgICAgICAgdG9kb0tleXMuc2hpZnQoKTtcbiAgICAgICAgdG9kby5zaGlmdCgpKCk7XG4gICAgfVxuXG4gICAgaWYodG9kby5sZW5ndGgpe1xuICAgICAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuKTtcbiAgICB9ZWxzZXtcbiAgICAgICAgc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzY2hlZHVsZShrZXksIGZuKXtcbiAgICBpZih+dG9kb0tleXMuaW5kZXhPZihrZXkpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRvZG8ucHVzaChmbik7XG4gICAgdG9kb0tleXMucHVzaChrZXkpO1xuXG4gICAgaWYoIXNjaGVkdWxlZCl7XG4gICAgICAgIHNjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZShydW4pO1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzY2hlZHVsZTsiLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZhc3RuLCBjb21wb25lbnQsIHR5cGUsIHNldHRpbmdzLCBjaGlsZHJlbil7XG4gICAgdmFyIGl0ZW1Nb2RlbCA9IG5ldyBmYXN0bi5Nb2RlbCh7fSk7XG5cbiAgICBpZighKCd0ZW1wbGF0ZScgaW4gc2V0dGluZ3MpKXtcbiAgICAgICAgY29uc29sZS53YXJuKCdObyBcInRlbXBsYXRlXCIgZnVuY3Rpb24gd2FzIHNldCBmb3IgdGhpcyB0ZW1wbGF0ZXIgY29tcG9uZW50Jyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVwbGFjZUVsZW1lbnQoZWxlbWVudCl7XG4gICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50ICYmIGNvbXBvbmVudC5lbGVtZW50LnBhcmVudE5vZGUpe1xuICAgICAgICAgICAgY29tcG9uZW50LmVsZW1lbnQucGFyZW50Tm9kZS5yZXBsYWNlQ2hpbGQoZWxlbWVudCwgY29tcG9uZW50LmVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudC5lbGVtZW50ID0gZWxlbWVudDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGUoKXtcblxuICAgICAgICB2YXIgdmFsdWUgPSBjb21wb25lbnQuZGF0YSgpLFxuICAgICAgICAgICAgdGVtcGxhdGUgPSBjb21wb25lbnQudGVtcGxhdGUoKTtcblxuICAgICAgICBpdGVtTW9kZWwuc2V0KCdpdGVtJywgdmFsdWUpO1xuXG4gICAgICAgIHZhciBuZXdDb21wb25lbnQ7XG5cbiAgICAgICAgaWYodGVtcGxhdGUpe1xuICAgICAgICAgICBuZXdDb21wb25lbnQgPSBmYXN0bi50b0NvbXBvbmVudCh0ZW1wbGF0ZShpdGVtTW9kZWwsIGNvbXBvbmVudC5zY29wZSgpLCBjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudCAmJiBjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQgIT09IG5ld0NvbXBvbmVudCl7XG4gICAgICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQpKXtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQuZGVzdHJveSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50ID0gbmV3Q29tcG9uZW50O1xuXG4gICAgICAgIGlmKCFuZXdDb21wb25lbnQpe1xuICAgICAgICAgICAgcmVwbGFjZUVsZW1lbnQoY29tcG9uZW50LmVtcHR5RWxlbWVudCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChuZXdDb21wb25lbnQpKXtcbiAgICAgICAgICAgIGlmKGNvbXBvbmVudC5fc2V0dGluZ3MuYXR0YWNoVGVtcGxhdGVzICE9PSBmYWxzZSl7XG4gICAgICAgICAgICAgICAgbmV3Q29tcG9uZW50LmF0dGFjaChpdGVtTW9kZWwsIDIpO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgbmV3Q29tcG9uZW50LmF0dGFjaChjb21wb25lbnQuc2NvcGUoKSwgMSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKGNvbXBvbmVudC5lbGVtZW50ICYmIGNvbXBvbmVudC5lbGVtZW50ICE9PSBuZXdDb21wb25lbnQuZWxlbWVudCl7XG4gICAgICAgICAgICAgICAgaWYobmV3Q29tcG9uZW50LmVsZW1lbnQgPT0gbnVsbCl7XG4gICAgICAgICAgICAgICAgICAgIG5ld0NvbXBvbmVudC5yZW5kZXIoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVwbGFjZUVsZW1lbnQoY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50LmVsZW1lbnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29tcG9uZW50LnJlbmRlciA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHZhciBlbGVtZW50O1xuICAgICAgICBjb21wb25lbnQuZW1wdHlFbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICAgICAgICBpZihjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQpe1xuICAgICAgICAgICAgY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50LnJlbmRlcigpO1xuICAgICAgICAgICAgZWxlbWVudCA9IGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudC5lbGVtZW50O1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudC5lbGVtZW50ID0gZWxlbWVudCB8fCBjb21wb25lbnQuZW1wdHlFbGVtZW50O1xuICAgICAgICBjb21wb25lbnQuZW1pdCgncmVuZGVyJyk7XG4gICAgICAgIHJldHVybiBjb21wb25lbnQ7XG4gICAgfTtcblxuICAgIGNvbXBvbmVudC5zZXRQcm9wZXJ0eSgnZGF0YScsXG4gICAgICAgIGZhc3RuLnByb3BlcnR5KHVuZGVmaW5lZCwgc2V0dGluZ3MuZGF0YUNoYW5nZXMgfHwgJ3ZhbHVlIHN0cnVjdHVyZScpXG4gICAgICAgICAgICAub24oJ2NoYW5nZScsIHVwZGF0ZSlcbiAgICApO1xuXG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5KCd0ZW1wbGF0ZScsXG4gICAgICAgIGZhc3RuLnByb3BlcnR5KHVuZGVmaW5lZCwgJ3ZhbHVlIHJlZmVyZW5jZScpXG4gICAgICAgICAgICAub24oJ2NoYW5nZScsIHVwZGF0ZSlcbiAgICApO1xuXG4gICAgY29tcG9uZW50Lm9uKCdkZXN0cm95JywgZnVuY3Rpb24oKXtcbiAgICAgICAgaWYoZmFzdG4uaXNDb21wb25lbnQoY29tcG9uZW50Ll9jdXJyZW50Q29tcG9uZW50KSl7XG4gICAgICAgICAgICBjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQuZGVzdHJveSgpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBjb21wb25lbnQub24oJ2F0dGFjaCcsIGZ1bmN0aW9uKGRhdGEpe1xuICAgICAgICBpZihmYXN0bi5pc0NvbXBvbmVudChjb21wb25lbnQuX2N1cnJlbnRDb21wb25lbnQpKXtcbiAgICAgICAgICAgIGNvbXBvbmVudC5fY3VycmVudENvbXBvbmVudC5hdHRhY2goY29tcG9uZW50LnNjb3BlKCksIDEpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29tcG9uZW50O1xufTsiLCJmdW5jdGlvbiB1cGRhdGVUZXh0KCl7XG4gICAgaWYoIXRoaXMuZWxlbWVudCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgdmFsdWUgPSB0aGlzLnRleHQoKTtcblxuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGF1dG9SZW5kZXIoY29udGVudCl7XG4gICAgdGhpcy5lbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoY29udGVudCk7XG59XG5cbmZ1bmN0aW9uIGF1dG9UZXh0KHRleHQsIGZhc3RuLCBjb250ZW50KSB7XG4gICAgdGV4dC5yZW5kZXIgPSBhdXRvUmVuZGVyLmJpbmQodGV4dCwgY29udGVudCk7XG5cbiAgICByZXR1cm4gdGV4dDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyKCl7XG4gICAgdGhpcy5lbGVtZW50ID0gdGhpcy5jcmVhdGVUZXh0Tm9kZSh0aGlzLnRleHQoKSk7XG4gICAgdGhpcy5lbWl0KCdyZW5kZXInKTtcbn07XG5cbmZ1bmN0aW9uIHRleHRDb21wb25lbnQoZmFzdG4sIGNvbXBvbmVudCwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuKXtcbiAgICBjb21wb25lbnQuY3JlYXRlVGV4dE5vZGUgPSB0ZXh0Q29tcG9uZW50LmNyZWF0ZVRleHROb2RlO1xuICAgIGNvbXBvbmVudC5yZW5kZXIgPSByZW5kZXIuYmluZChjb21wb25lbnQpO1xuXG4gICAgY29tcG9uZW50LnNldFByb3BlcnR5KCd0ZXh0JywgZmFzdG4ucHJvcGVydHkoJycsIHVwZGF0ZVRleHQuYmluZChjb21wb25lbnQpKSk7XG5cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuXG50ZXh0Q29tcG9uZW50LmNyZWF0ZVRleHROb2RlID0gZnVuY3Rpb24odGV4dCl7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSB0ZXh0Q29tcG9uZW50OyIsImZ1bmN0aW9uIGZsYXRNZXJnZShhLGIpe1xuICAgIGlmKCFiIHx8IHR5cGVvZiBiICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIGIgPSB7fTtcbiAgICB9XG5cbiAgICBpZighYSB8fCB0eXBlb2YgYSAhPT0gJ29iamVjdCcpe1xuICAgICAgICBhID0gbmV3IGIuY29uc3RydWN0b3IoKTtcbiAgICB9XG5cbiAgICB2YXIgcmVzdWx0ID0gbmV3IGEuY29uc3RydWN0b3IoKSxcbiAgICAgICAgYUtleXMgPSBPYmplY3Qua2V5cyhhKSxcbiAgICAgICAgYktleXMgPSBPYmplY3Qua2V5cyhiKTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhS2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlc3VsdFthS2V5c1tpXV0gPSBhW2FLZXlzW2ldXTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYktleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYktleXNbaV1dID0gYltiS2V5c1tpXV07XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmbGF0TWVyZ2U7IiwidmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcixcbiAgICBmdW5jdGlvbkVtaXR0ZXJQcm90b3R5cGUgPSBmdW5jdGlvbigpe307XG5cbmZvcih2YXIga2V5IGluIEV2ZW50RW1pdHRlci5wcm90b3R5cGUpe1xuICAgIGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZVtrZXldID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZVtrZXldO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uRW1pdHRlclByb3RvdHlwZTsiLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IChuQnl0ZXMgKiA4KSAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgbkJpdHMgPSAtN1xuICB2YXIgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwXG4gIHZhciBkID0gaXNMRSA/IC0xIDogMVxuICB2YXIgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXVxuXG4gIGkgKz0gZFxuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIHMgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IGVMZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IChlICogMjU2KSArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIGUgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IG1MZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IChtICogMjU2KSArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSAobkJ5dGVzICogOCkgLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKVxuICB2YXIgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpXG4gIHZhciBkID0gaXNMRSA/IDEgOiAtMVxuICB2YXIgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMFxuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpXG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDBcbiAgICBlID0gZU1heFxuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKVxuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLVxuICAgICAgYyAqPSAyXG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKVxuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrK1xuICAgICAgYyAvPSAyXG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMFxuICAgICAgZSA9IGVNYXhcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKCh2YWx1ZSAqIGMpIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IGUgKyBlQmlhc1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSAwXG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCkge31cblxuICBlID0gKGUgPDwgbUxlbikgfCBtXG4gIGVMZW4gKz0gbUxlblxuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpIHt9XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4XG59XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuLyogZ2xvYmFsIG1vZHVsZSwgZGVmaW5lICovXG5cbmZ1bmN0aW9uIG1hcEVhY2gobWFwLCBvcGVyYXRpb24pe1xuICB2YXIga2V5cyA9IG1hcC5rZXlzKCk7XG4gIHZhciBuZXh0O1xuICB3aGlsZSghKG5leHQgPSBrZXlzLm5leHQoKSkuZG9uZSkge1xuICAgIG9wZXJhdGlvbihtYXAuZ2V0KG5leHQudmFsdWUpLCBuZXh0LnZhbHVlLCBtYXApO1xuICB9XG59XG5cbnZhciBNdWx0aW1hcCA9IChmdW5jdGlvbigpIHtcbiAgdmFyIG1hcEN0b3I7XG4gIGlmICh0eXBlb2YgTWFwICE9PSAndW5kZWZpbmVkJykge1xuICAgIG1hcEN0b3IgPSBNYXA7XG5cbiAgICBpZiAoIU1hcC5wcm90b3R5cGUua2V5cykge1xuICAgICAgTWFwLnByb3RvdHlwZS5rZXlzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBrZXlzID0gW107XG4gICAgICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbihpdGVtLCBrZXkpIHtcbiAgICAgICAgICBrZXlzLnB1c2goa2V5KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBrZXlzO1xuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBNdWx0aW1hcChpdGVyYWJsZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHNlbGYuX21hcCA9IG1hcEN0b3I7XG5cbiAgICBpZiAoTXVsdGltYXAuTWFwKSB7XG4gICAgICBzZWxmLl9tYXAgPSBNdWx0aW1hcC5NYXA7XG4gICAgfVxuXG4gICAgc2VsZi5fID0gc2VsZi5fbWFwID8gbmV3IHNlbGYuX21hcCgpIDoge307XG5cbiAgICBpZiAoaXRlcmFibGUpIHtcbiAgICAgIGl0ZXJhYmxlLmZvckVhY2goZnVuY3Rpb24oaSkge1xuICAgICAgICBzZWxmLnNldChpWzBdLCBpWzFdKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0ge09iamVjdH0ga2V5XG4gICAqIEByZXR1cm4ge0FycmF5fSBBbiBhcnJheSBvZiB2YWx1ZXMsIHVuZGVmaW5lZCBpZiBubyBzdWNoIGEga2V5O1xuICAgKi9cbiAgTXVsdGltYXAucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGtleSkge1xuICAgIHJldHVybiB0aGlzLl9tYXAgPyB0aGlzLl8uZ2V0KGtleSkgOiB0aGlzLl9ba2V5XTtcbiAgfTtcblxuICAvKipcbiAgICogQHBhcmFtIHtPYmplY3R9IGtleVxuICAgKiBAcGFyYW0ge09iamVjdH0gdmFsLi4uXG4gICAqL1xuICBNdWx0aW1hcC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWwpIHtcbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgICBrZXkgPSBhcmdzLnNoaWZ0KCk7XG5cbiAgICB2YXIgZW50cnkgPSB0aGlzLmdldChrZXkpO1xuICAgIGlmICghZW50cnkpIHtcbiAgICAgIGVudHJ5ID0gW107XG4gICAgICBpZiAodGhpcy5fbWFwKVxuICAgICAgICB0aGlzLl8uc2V0KGtleSwgZW50cnkpO1xuICAgICAgZWxzZVxuICAgICAgICB0aGlzLl9ba2V5XSA9IGVudHJ5O1xuICAgIH1cblxuICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KGVudHJ5LCBhcmdzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfTtcblxuICAvKipcbiAgICogQHBhcmFtIHtPYmplY3R9IGtleVxuICAgKiBAcGFyYW0ge09iamVjdD19IHZhbFxuICAgKiBAcmV0dXJuIHtib29sZWFufSB0cnVlIGlmIGFueSB0aGluZyBjaGFuZ2VkXG4gICAqL1xuICBNdWx0aW1hcC5wcm90b3R5cGUuZGVsZXRlID0gZnVuY3Rpb24oa2V5LCB2YWwpIHtcbiAgICBpZiAoIXRoaXMuaGFzKGtleSkpXG4gICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PSAxKSB7XG4gICAgICB0aGlzLl9tYXAgPyAodGhpcy5fLmRlbGV0ZShrZXkpKSA6IChkZWxldGUgdGhpcy5fW2tleV0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBlbnRyeSA9IHRoaXMuZ2V0KGtleSk7XG4gICAgICB2YXIgaWR4ID0gZW50cnkuaW5kZXhPZih2YWwpO1xuICAgICAgaWYgKGlkeCAhPSAtMSkge1xuICAgICAgICBlbnRyeS5zcGxpY2UoaWR4LCAxKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBAcGFyYW0ge09iamVjdH0ga2V5XG4gICAqIEBwYXJhbSB7T2JqZWN0PX0gdmFsXG4gICAqIEByZXR1cm4ge2Jvb2xlYW59IHdoZXRoZXIgdGhlIG1hcCBjb250YWlucyAna2V5JyBvciAna2V5PT52YWwnIHBhaXJcbiAgICovXG4gIE11bHRpbWFwLnByb3RvdHlwZS5oYXMgPSBmdW5jdGlvbihrZXksIHZhbCkge1xuICAgIHZhciBoYXNLZXkgPSB0aGlzLl9tYXAgPyB0aGlzLl8uaGFzKGtleSkgOiB0aGlzLl8uaGFzT3duUHJvcGVydHkoa2V5KTtcblxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09IDEgfHwgIWhhc0tleSlcbiAgICAgIHJldHVybiBoYXNLZXk7XG5cbiAgICB2YXIgZW50cnkgPSB0aGlzLmdldChrZXkpIHx8IFtdO1xuICAgIHJldHVybiBlbnRyeS5pbmRleE9mKHZhbCkgIT0gLTE7XG4gIH07XG5cblxuICAvKipcbiAgICogQHJldHVybiB7QXJyYXl9IGFsbCB0aGUga2V5cyBpbiB0aGUgbWFwXG4gICAqL1xuICBNdWx0aW1hcC5wcm90b3R5cGUua2V5cyA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9tYXApXG4gICAgICByZXR1cm4gbWFrZUl0ZXJhdG9yKHRoaXMuXy5rZXlzKCkpO1xuXG4gICAgcmV0dXJuIG1ha2VJdGVyYXRvcihPYmplY3Qua2V5cyh0aGlzLl8pKTtcbiAgfTtcblxuICAvKipcbiAgICogQHJldHVybiB7QXJyYXl9IGFsbCB0aGUgdmFsdWVzIGluIHRoZSBtYXBcbiAgICovXG4gIE11bHRpbWFwLnByb3RvdHlwZS52YWx1ZXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFscyA9IFtdO1xuICAgIHRoaXMuZm9yRWFjaEVudHJ5KGZ1bmN0aW9uKGVudHJ5KSB7XG4gICAgICBBcnJheS5wcm90b3R5cGUucHVzaC5hcHBseSh2YWxzLCBlbnRyeSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gbWFrZUl0ZXJhdG9yKHZhbHMpO1xuICB9O1xuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgTXVsdGltYXAucHJvdG90eXBlLmZvckVhY2hFbnRyeSA9IGZ1bmN0aW9uKGl0ZXIpIHtcbiAgICBtYXBFYWNoKHRoaXMsIGl0ZXIpO1xuICB9O1xuXG4gIE11bHRpbWFwLnByb3RvdHlwZS5mb3JFYWNoID0gZnVuY3Rpb24oaXRlcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLmZvckVhY2hFbnRyeShmdW5jdGlvbihlbnRyeSwga2V5KSB7XG4gICAgICBlbnRyeS5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgICAgaXRlcihpdGVtLCBrZXksIHNlbGYpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cblxuICBNdWx0aW1hcC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5fbWFwKSB7XG4gICAgICB0aGlzLl8uY2xlYXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fID0ge307XG4gICAgfVxuICB9O1xuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShcbiAgICBNdWx0aW1hcC5wcm90b3R5cGUsXG4gICAgXCJzaXplXCIsIHtcbiAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2UsXG4gICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHRvdGFsID0gMDtcblxuICAgICAgICBtYXBFYWNoKHRoaXMsIGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgICB0b3RhbCArPSB2YWx1ZS5sZW5ndGg7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0b3RhbDtcbiAgICAgIH1cbiAgICB9KTtcblxuICB2YXIgc2FmYXJpTmV4dDtcblxuICB0cnl7XG4gICAgc2FmYXJpTmV4dCA9IG5ldyBGdW5jdGlvbignaXRlcmF0b3InLCAnbWFrZUl0ZXJhdG9yJywgJ3ZhciBrZXlzQXJyYXkgPSBbXTsgZm9yKHZhciBrZXkgb2YgaXRlcmF0b3Ipe2tleXNBcnJheS5wdXNoKGtleSk7fSByZXR1cm4gbWFrZUl0ZXJhdG9yKGtleXNBcnJheSkubmV4dDsnKTtcbiAgfWNhdGNoKGVycm9yKXtcbiAgICAvLyBmb3Igb2Ygbm90IGltcGxlbWVudGVkO1xuICB9XG5cbiAgZnVuY3Rpb24gbWFrZUl0ZXJhdG9yKGl0ZXJhdG9yKXtcbiAgICBpZihBcnJheS5pc0FycmF5KGl0ZXJhdG9yKSl7XG4gICAgICB2YXIgbmV4dEluZGV4ID0gMDtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmV4dDogZnVuY3Rpb24oKXtcbiAgICAgICAgICByZXR1cm4gbmV4dEluZGV4IDwgaXRlcmF0b3IubGVuZ3RoID9cbiAgICAgICAgICAgIHt2YWx1ZTogaXRlcmF0b3JbbmV4dEluZGV4KytdLCBkb25lOiBmYWxzZX0gOlxuICAgICAgICAgIHtkb25lOiB0cnVlfTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBPbmx5IGFuIGlzc3VlIGluIHNhZmFyaVxuICAgIGlmKCFpdGVyYXRvci5uZXh0ICYmIHNhZmFyaU5leHQpe1xuICAgICAgaXRlcmF0b3IubmV4dCA9IHNhZmFyaU5leHQoaXRlcmF0b3IsIG1ha2VJdGVyYXRvcik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGl0ZXJhdG9yO1xuICB9XG5cbiAgcmV0dXJuIE11bHRpbWFwO1xufSkoKTtcblxuXG5pZih0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgbW9kdWxlICYmIG1vZHVsZS5leHBvcnRzKVxuICBtb2R1bGUuZXhwb3J0cyA9IE11bHRpbWFwO1xuZWxzZSBpZih0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpXG4gIGRlZmluZShmdW5jdGlvbigpIHsgcmV0dXJuIE11bHRpbWFwOyB9KTtcbiIsInZhciBzdXBwb3J0ZWRUeXBlcyA9IFsndGV4dGFyZWEnLCAndGV4dCcsICdzZWFyY2gnLCAndGVsJywgJ3VybCcsICdwYXNzd29yZCddO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICByZXR1cm4gISEoZWxlbWVudC5zZXRTZWxlY3Rpb25SYW5nZSAmJiB+c3VwcG9ydGVkVHlwZXMuaW5kZXhPZihlbGVtZW50LnR5cGUpKTtcbn07XG4iLCIvKlxub2JqZWN0LWFzc2lnblxuKGMpIFNpbmRyZSBTb3JodXNcbkBsaWNlbnNlIE1JVFxuKi9cblxuJ3VzZSBzdHJpY3QnO1xuLyogZXNsaW50LWRpc2FibGUgbm8tdW51c2VkLXZhcnMgKi9cbnZhciBnZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzO1xudmFyIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcbnZhciBwcm9wSXNFbnVtZXJhYmxlID0gT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZTtcblxuZnVuY3Rpb24gdG9PYmplY3QodmFsKSB7XG5cdGlmICh2YWwgPT09IG51bGwgfHwgdmFsID09PSB1bmRlZmluZWQpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKCdPYmplY3QuYXNzaWduIGNhbm5vdCBiZSBjYWxsZWQgd2l0aCBudWxsIG9yIHVuZGVmaW5lZCcpO1xuXHR9XG5cblx0cmV0dXJuIE9iamVjdCh2YWwpO1xufVxuXG5mdW5jdGlvbiBzaG91bGRVc2VOYXRpdmUoKSB7XG5cdHRyeSB7XG5cdFx0aWYgKCFPYmplY3QuYXNzaWduKSB7XG5cdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0fVxuXG5cdFx0Ly8gRGV0ZWN0IGJ1Z2d5IHByb3BlcnR5IGVudW1lcmF0aW9uIG9yZGVyIGluIG9sZGVyIFY4IHZlcnNpb25zLlxuXG5cdFx0Ly8gaHR0cHM6Ly9idWdzLmNocm9taXVtLm9yZy9wL3Y4L2lzc3Vlcy9kZXRhaWw/aWQ9NDExOFxuXHRcdHZhciB0ZXN0MSA9IG5ldyBTdHJpbmcoJ2FiYycpOyAgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1uZXctd3JhcHBlcnNcblx0XHR0ZXN0MVs1XSA9ICdkZSc7XG5cdFx0aWYgKE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHRlc3QxKVswXSA9PT0gJzUnKSB7XG5cdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0fVxuXG5cdFx0Ly8gaHR0cHM6Ly9idWdzLmNocm9taXVtLm9yZy9wL3Y4L2lzc3Vlcy9kZXRhaWw/aWQ9MzA1NlxuXHRcdHZhciB0ZXN0MiA9IHt9O1xuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgMTA7IGkrKykge1xuXHRcdFx0dGVzdDJbJ18nICsgU3RyaW5nLmZyb21DaGFyQ29kZShpKV0gPSBpO1xuXHRcdH1cblx0XHR2YXIgb3JkZXIyID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXModGVzdDIpLm1hcChmdW5jdGlvbiAobikge1xuXHRcdFx0cmV0dXJuIHRlc3QyW25dO1xuXHRcdH0pO1xuXHRcdGlmIChvcmRlcjIuam9pbignJykgIT09ICcwMTIzNDU2Nzg5Jykge1xuXHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdH1cblxuXHRcdC8vIGh0dHBzOi8vYnVncy5jaHJvbWl1bS5vcmcvcC92OC9pc3N1ZXMvZGV0YWlsP2lkPTMwNTZcblx0XHR2YXIgdGVzdDMgPSB7fTtcblx0XHQnYWJjZGVmZ2hpamtsbW5vcHFyc3QnLnNwbGl0KCcnKS5mb3JFYWNoKGZ1bmN0aW9uIChsZXR0ZXIpIHtcblx0XHRcdHRlc3QzW2xldHRlcl0gPSBsZXR0ZXI7XG5cdFx0fSk7XG5cdFx0aWYgKE9iamVjdC5rZXlzKE9iamVjdC5hc3NpZ24oe30sIHRlc3QzKSkuam9pbignJykgIT09XG5cdFx0XHRcdCdhYmNkZWZnaGlqa2xtbm9wcXJzdCcpIHtcblx0XHRcdHJldHVybiBmYWxzZTtcblx0XHR9XG5cblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0Ly8gV2UgZG9uJ3QgZXhwZWN0IGFueSBvZiB0aGUgYWJvdmUgdG8gdGhyb3csIGJ1dCBiZXR0ZXIgdG8gYmUgc2FmZS5cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzaG91bGRVc2VOYXRpdmUoKSA/IE9iamVjdC5hc3NpZ24gOiBmdW5jdGlvbiAodGFyZ2V0LCBzb3VyY2UpIHtcblx0dmFyIGZyb207XG5cdHZhciB0byA9IHRvT2JqZWN0KHRhcmdldCk7XG5cdHZhciBzeW1ib2xzO1xuXG5cdGZvciAodmFyIHMgPSAxOyBzIDwgYXJndW1lbnRzLmxlbmd0aDsgcysrKSB7XG5cdFx0ZnJvbSA9IE9iamVjdChhcmd1bWVudHNbc10pO1xuXG5cdFx0Zm9yICh2YXIga2V5IGluIGZyb20pIHtcblx0XHRcdGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKGZyb20sIGtleSkpIHtcblx0XHRcdFx0dG9ba2V5XSA9IGZyb21ba2V5XTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRpZiAoZ2V0T3duUHJvcGVydHlTeW1ib2xzKSB7XG5cdFx0XHRzeW1ib2xzID0gZ2V0T3duUHJvcGVydHlTeW1ib2xzKGZyb20pO1xuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBzeW1ib2xzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRcdGlmIChwcm9wSXNFbnVtZXJhYmxlLmNhbGwoZnJvbSwgc3ltYm9sc1tpXSkpIHtcblx0XHRcdFx0XHR0b1tzeW1ib2xzW2ldXSA9IGZyb21bc3ltYm9sc1tpXV07XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdG87XG59O1xuIiwidmFyIFNjb3BlID0gcmVxdWlyZSgnLi9zY29wZScpLFxuICAgIHRvVmFsdWUgPSByZXF1aXJlKCcuL3RvVmFsdWUnKSxcbiAgICBpc0luc3RhbmNlID0gcmVxdWlyZSgnaXMtaW5zdGFuY2UnKTtcblxudmFyIHJlc2VydmVkS2V5d29yZHMgPSB7XG4gICAgJ3RydWUnOiB0cnVlLFxuICAgICdmYWxzZSc6IGZhbHNlLFxuICAgICdudWxsJzogbnVsbCxcbiAgICAndW5kZWZpbmVkJzogdW5kZWZpbmVkXG59O1xuXG5mdW5jdGlvbiByZXNvbHZlU3ByZWFkcyhjb250ZW50LCBzY29wZSl7XG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuXG4gICAgY29udGVudC5mb3JFYWNoKGZ1bmN0aW9uKHRva2VuKXtcblxuICAgICAgICBpZih0b2tlbi5uYW1lID09PSAnc3ByZWFkJyl7XG4gICAgICAgICAgICByZXN1bHQucHVzaC5hcHBseShyZXN1bHQsIGV4ZWN1dGVUb2tlbih0b2tlbiwgc2NvcGUpLnZhbHVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3VsdC5wdXNoKGV4ZWN1dGVUb2tlbih0b2tlbiwgc2NvcGUpLnZhbHVlKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGZ1bmN0aW9uQ2FsbCh0b2tlbiwgc2NvcGUpe1xuICAgIHZhciBmdW5jdGlvblRva2VuID0gZXhlY3V0ZVRva2VuKHRva2VuLnRhcmdldCwgc2NvcGUpLFxuICAgICAgICBmbiA9IGZ1bmN0aW9uVG9rZW4udmFsdWU7XG5cbiAgICBpZih0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpe1xuICAgICAgICBzY29wZS50aHJvdyhmbiArICcgaXMgbm90IGEgZnVuY3Rpb24nKTtcbiAgICB9XG5cbiAgICBpZihzY29wZS5oYXNFcnJvcigpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKGZuLl9fcHJlc2hGdW5jdGlvbl9fKXtcbiAgICAgICAgcmV0dXJuIGZuLmFwcGx5KGZ1bmN0aW9uVG9rZW4uY29udGV4dCwgcmVzb2x2ZVNwcmVhZHModG9rZW4uY29udGVudCwgc2NvcGUpKTtcbiAgICB9XG5cbiAgICB0cnl7XG4gICAgICAgIHJldHVybiBmbi5hcHBseShmdW5jdGlvblRva2VuLmNvbnRleHQsIHJlc29sdmVTcHJlYWRzKHRva2VuLmNvbnRlbnQsIHNjb3BlKSk7XG4gICAgfWNhdGNoKGVycm9yKXtcbiAgICAgICAgc2NvcGUudGhyb3coZXJyb3IpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZnVuY3Rpb25FeHByZXNzaW9uKHRva2VuLCBzY29wZSl7XG4gICAgdmFyIGZuID0gZnVuY3Rpb24oKXtcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHMsXG4gICAgICAgICAgICBmdW5jdGlvblNjb3BlID0gbmV3IFNjb3BlKHNjb3BlKTtcblxuICAgICAgICB0b2tlbi5wYXJhbWV0ZXJzLmZvckVhY2goZnVuY3Rpb24ocGFyYW1ldGVyLCBpbmRleCl7XG5cbiAgICAgICAgICAgIGlmKHBhcmFtZXRlci5uYW1lID09PSAnc3ByZWFkJyl7XG4gICAgICAgICAgICAgICAgZnVuY3Rpb25TY29wZS5zZXQocGFyYW1ldGVyLnJpZ2h0Lm5hbWUsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3MsIGluZGV4KSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmdW5jdGlvblNjb3BlLnNldChwYXJhbWV0ZXIubmFtZSwgYXJnc1tpbmRleF0pO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gZXhlY3V0ZSh0b2tlbi5jb250ZW50LCBmdW5jdGlvblNjb3BlKS52YWx1ZTtcbiAgICB9O1xuXG4gICAgaWYodG9rZW4uaWRlbnRpZmllcil7XG4gICAgICAgIHNjb3BlLnNldCh0b2tlbi5pZGVudGlmaWVyLm5hbWUsIGZuKTtcbiAgICB9XG5cbiAgICBmbi5fX3ByZXNoRnVuY3Rpb25fXyA9IHRydWU7XG5cbiAgICByZXR1cm4gZm47XG59XG5cbmZ1bmN0aW9uIHRlcm5hcnkodG9rZW4sIHNjb3BlKXtcblxuICAgIGlmKHNjb3BlLl9kZWJ1Zyl7XG4gICAgICAgIGNvbnNvbGUubG9nKCdFeGVjdXRpbmcgb3BlcmF0b3I6ICcgKyBvcGVyYXRvci5uYW1lLCBvcGVyYXRvci5sZWZ0LCBvcGVyYXRvci5yaWdodCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGV4ZWN1dGVUb2tlbih0b2tlbi5sZWZ0LCBzY29wZSkudmFsdWUgP1xuICAgICAgICBleGVjdXRlVG9rZW4odG9rZW4ubWlkZGxlLCBzY29wZSkudmFsdWUgOlxuICAgICAgICBleGVjdXRlVG9rZW4odG9rZW4ucmlnaHQsIHNjb3BlKS52YWx1ZTtcbn1cblxuZnVuY3Rpb24gaWRlbnRpZmllcih0b2tlbiwgc2NvcGUpe1xuICAgIHZhciBuYW1lID0gdG9rZW4ubmFtZTtcbiAgICBpZihuYW1lIGluIHJlc2VydmVkS2V5d29yZHMpe1xuICAgICAgICByZXR1cm4gcmVzZXJ2ZWRLZXl3b3Jkc1tuYW1lXTtcbiAgICB9XG4gICAgaWYoIXNjb3BlLmlzRGVmaW5lZChuYW1lKSl7XG4gICAgICAgIHNjb3BlLnRocm93KG5hbWUgKyAnIGlzIG5vdCBkZWZpbmVkJyk7XG4gICAgfVxuICAgIHJldHVybiBzY29wZS5nZXQobmFtZSk7XG59XG5cbmZ1bmN0aW9uIG51bWJlcih0b2tlbil7XG4gICAgcmV0dXJuIHRva2VuLnZhbHVlO1xufVxuXG5mdW5jdGlvbiBzdHJpbmcodG9rZW4pe1xuICAgIHJldHVybiB0b2tlbi52YWx1ZTtcbn1cblxuZnVuY3Rpb24gZ2V0UHJvcGVydHkodG9rZW4sIHNjb3BlLCB0YXJnZXQsIGFjY2Vzc29yKXtcblxuICAgIGlmKCF0YXJnZXQgfHwgISh0eXBlb2YgdGFyZ2V0ID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgdGFyZ2V0ID09PSAnZnVuY3Rpb24nKSl7XG4gICAgICAgIHNjb3BlLnRocm93KCd0YXJnZXQgaXMgbm90IGFuIG9iamVjdCcpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG5cbiAgICB2YXIgcmVzdWx0ID0gdGFyZ2V0Lmhhc093blByb3BlcnR5KGFjY2Vzc29yKSA/IHRhcmdldFthY2Nlc3Nvcl0gOiB1bmRlZmluZWQ7XG5cbiAgICBpZih0eXBlb2YgcmVzdWx0ID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgcmVzdWx0ID0gdG9WYWx1ZShyZXN1bHQsIHNjb3BlLCB0YXJnZXQpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIHBlcmlvZCh0b2tlbiwgc2NvcGUpe1xuICAgIHZhciB0YXJnZXQgPSBleGVjdXRlVG9rZW4odG9rZW4ubGVmdCwgc2NvcGUpLnZhbHVlO1xuXG4gICAgcmV0dXJuIGdldFByb3BlcnR5KHRva2VuLCBzY29wZSwgdGFyZ2V0LCB0b2tlbi5yaWdodC5uYW1lKTtcbn1cblxuZnVuY3Rpb24gYWNjZXNzb3IodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgYWNjZXNzb3JWYWx1ZSA9IGV4ZWN1dGUodG9rZW4uY29udGVudCwgc2NvcGUpLnZhbHVlLFxuICAgICAgICB0YXJnZXQgPSBleGVjdXRlVG9rZW4odG9rZW4udGFyZ2V0LCBzY29wZSkudmFsdWU7XG5cbiAgICByZXR1cm4gZ2V0UHJvcGVydHkodG9rZW4sIHNjb3BlLCB0YXJnZXQsIGFjY2Vzc29yVmFsdWUpO1xufVxuXG5mdW5jdGlvbiBzcHJlYWQodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgdGFyZ2V0ID0gZXhlY3V0ZVRva2VuKHRva2VuLnJpZ2h0LCBzY29wZSkudmFsdWU7XG5cbiAgICBpZighQXJyYXkuaXNBcnJheSh0YXJnZXQpKXtcbiAgICAgICAgc2NvcGUudGhyb3coJ3RhcmdldCBkaWQgbm90IHJlc29sdmUgdG8gYW4gYXJyYXknKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGFyZ2V0O1xufVxuXG5mdW5jdGlvbiBzZXQodG9rZW4sIHNjb3BlKXtcbiAgICBpZih0b2tlbi5jb250ZW50Lmxlbmd0aCA9PT0gMSAmJiB0b2tlbi5jb250ZW50WzBdLm5hbWUgPT09ICdyYW5nZScpe1xuICAgICAgICB2YXIgcmFuZ2UgPSB0b2tlbi5jb250ZW50WzBdLFxuICAgICAgICAgICAgc3RhcnQgPSBleGVjdXRlVG9rZW4ocmFuZ2UubGVmdCwgc2NvcGUpLnZhbHVlLFxuICAgICAgICAgICAgZW5kID0gZXhlY3V0ZVRva2VuKHJhbmdlLnJpZ2h0LCBzY29wZSkudmFsdWUsXG4gICAgICAgICAgICByZXZlcnNlID0gZW5kIDwgc3RhcnQsXG4gICAgICAgICAgICByZXN1bHQgPSBbXTtcblxuICAgICAgICBmb3IgKHZhciBpID0gc3RhcnQ7IHJldmVyc2UgPyBpID49IGVuZCA6IGkgPD0gZW5kOyByZXZlcnNlID8gaS0tIDogaSsrKSB7XG4gICAgICAgICAgICByZXN1bHQucHVzaChpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmVTcHJlYWRzKHRva2VuLmNvbnRlbnQsIHNjb3BlKTtcbn1cblxuZnVuY3Rpb24gdmFsdWUodG9rZW4pe1xuICAgIHJldHVybiB0b2tlbi52YWx1ZTtcbn1cblxuZnVuY3Rpb24gb2JqZWN0KHRva2VuLCBzY29wZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9O1xuXG4gICAgdmFyIGNvbnRlbnQgPSB0b2tlbi5jb250ZW50O1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRlbnQubGVuZ3RoOyBpICsrKSB7XG4gICAgICAgIHZhciBjaGlsZCA9IGNvbnRlbnRbaV0sXG4gICAgICAgICAgICBrZXksXG4gICAgICAgICAgICB2YWx1ZTtcblxuICAgICAgICBpZihjaGlsZC5uYW1lID09PSAndHVwbGUnKXtcbiAgICAgICAgICAgIGlmKGNoaWxkLmxlZnQudHlwZSA9PT0gJ2lkZW50aWZpZXInKXtcbiAgICAgICAgICAgICAgICBrZXkgPSBjaGlsZC5sZWZ0Lm5hbWU7XG4gICAgICAgICAgICB9ZWxzZSBpZihjaGlsZC5sZWZ0LnR5cGUgPT09ICdzZXQnICYmIGNoaWxkLmxlZnQuY29udGVudC5sZW5ndGggPT09IDEpe1xuICAgICAgICAgICAgICAgIGtleSA9IGV4ZWN1dGVUb2tlbihjaGlsZC5sZWZ0LmNvbnRlbnRbMF0sIHNjb3BlKS52YWx1ZTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHNjb3BlLnRocm93KCdVbmV4cGVjdGVkIHRva2VuIGluIG9iamVjdCBjb25zdHJ1Y3RvcjogJyArIGNoaWxkLnR5cGUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFsdWUgPSBleGVjdXRlVG9rZW4oY2hpbGQucmlnaHQsIHNjb3BlKS52YWx1ZTtcbiAgICAgICAgfWVsc2UgaWYoY2hpbGQudHlwZSA9PT0gJ2lkZW50aWZpZXInKXtcbiAgICAgICAgICAgIGtleSA9IGNoaWxkLm5hbWU7XG4gICAgICAgICAgICB2YWx1ZSA9IGV4ZWN1dGVUb2tlbihjaGlsZCwgc2NvcGUpLnZhbHVlO1xuICAgICAgICB9ZWxzZSBpZihjaGlsZC5uYW1lID09PSAnc3ByZWFkJyl7XG4gICAgICAgICAgICB2YXIgc291cmNlID0gZXhlY3V0ZVRva2VuKGNoaWxkLnJpZ2h0LCBzY29wZSkudmFsdWU7XG5cbiAgICAgICAgICAgIGlmKCFpc0luc3RhbmNlKHNvdXJjZSkpe1xuICAgICAgICAgICAgICAgIHNjb3BlLnRocm93KCdUYXJnZXQgZGlkIG5vdCByZXNvbHZlIHRvIGFuIGluc3RhbmNlIG9mIGFuIG9iamVjdCcpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihyZXN1bHQsIHNvdXJjZSk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfWVsc2UgaWYoY2hpbGQubmFtZSA9PT0gJ2RlbGV0ZScpe1xuICAgICAgICAgICAgdmFyIHRhcmdldElkZW50aWZpZXIgPSBjaGlsZC5yaWdodDtcblxuICAgICAgICAgICAgaWYodGFyZ2V0SWRlbnRpZmllci50eXBlICE9PSAnaWRlbnRpZmllcicpe1xuICAgICAgICAgICAgICAgIHNjb3BlLnRocm93KCdUYXJnZXQgb2YgZGVsZXRlIHdhcyBub3QgYW4gaWRlbnRpZmllcicpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZGVsZXRlIHJlc3VsdFt0YXJnZXRJZGVudGlmaWVyLm5hbWVdO1xuXG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBzY29wZS50aHJvdygnVW5leHBlY3RlZCB0b2tlbiBpbiBvYmplY3QgY29uc3RydWN0b3I6ICcgKyBjaGlsZC50eXBlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxudmFyIGhhbmRsZXJzID0ge1xuICAgIHRlcm5hcnk6IHRlcm5hcnksXG4gICAgZnVuY3Rpb25DYWxsOiBmdW5jdGlvbkNhbGwsXG4gICAgZnVuY3Rpb25FeHByZXNzaW9uOiBmdW5jdGlvbkV4cHJlc3Npb24sXG4gICAgbnVtYmVyOiBudW1iZXIsXG4gICAgc3RyaW5nOiBzdHJpbmcsXG4gICAgaWRlbnRpZmllcjogaWRlbnRpZmllcixcbiAgICBzZXQ6IHNldCxcbiAgICBwZXJpb2Q6IHBlcmlvZCxcbiAgICBzcHJlYWQ6IHNwcmVhZCxcbiAgICBhY2Nlc3NvcjogYWNjZXNzb3IsXG4gICAgdmFsdWU6IHZhbHVlLFxuICAgIG9wZXJhdG9yOiBvcGVyYXRvcixcbiAgICBwYXJlbnRoZXNpc0dyb3VwOiBjb250ZW50SG9sZGVyLFxuICAgIHN0YXRlbWVudDogY29udGVudEhvbGRlcixcbiAgICBicmFjZUdyb3VwOiBvYmplY3Rcbn07XG5cbmZ1bmN0aW9uIG5leHRPcGVyYXRvclRva2VuKHRva2VuLCBzY29wZSl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBleGVjdXRlVG9rZW4odG9rZW4sIHNjb3BlKS52YWx1ZTtcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBvcGVyYXRvcih0b2tlbiwgc2NvcGUpe1xuICAgIGlmKHRva2VuLm5hbWUgaW4gaGFuZGxlcnMpe1xuICAgICAgICByZXR1cm4gdG9WYWx1ZShoYW5kbGVyc1t0b2tlbi5uYW1lXSh0b2tlbiwgc2NvcGUpLCBzY29wZSk7XG4gICAgfVxuXG4gICAgaWYodG9rZW4ubGVmdCl7XG4gICAgICAgIGlmKHNjb3BlLl9kZWJ1Zyl7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIHRva2VuOiAnICsgdG9rZW4ubmFtZSwgdG9rZW4ubGVmdCwgdG9rZW4ucmlnaHQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0b2tlbi5vcGVyYXRvci5mbihuZXh0T3BlcmF0b3JUb2tlbih0b2tlbi5sZWZ0LCBzY29wZSksIG5leHRPcGVyYXRvclRva2VuKHRva2VuLnJpZ2h0LCBzY29wZSkpO1xuICAgIH1cblxuICAgIGlmKHNjb3BlLl9kZWJ1Zyl7XG4gICAgICAgIGNvbnNvbGUubG9nKCdFeGVjdXRpbmcgb3BlcmF0b3I6ICcgKyB0b2tlbi5uYW1lLiB0b2tlbi5yaWdodCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRva2VuLm9wZXJhdG9yLmZuKG5leHRPcGVyYXRvclRva2VuKHRva2VuLnJpZ2h0LCBzY29wZSkpO1xufVxuXG5mdW5jdGlvbiBjb250ZW50SG9sZGVyKHBhcmVudGhlc2lzR3JvdXAsIHNjb3BlKXtcbiAgICByZXR1cm4gZXhlY3V0ZShwYXJlbnRoZXNpc0dyb3VwLmNvbnRlbnQsIHNjb3BlKS52YWx1ZTtcbn1cblxuZnVuY3Rpb24gZXhlY3V0ZVRva2VuKHRva2VuLCBzY29wZSl7XG4gICAgaWYoc2NvcGUuX2Vycm9yKXtcbiAgICAgICAgcmV0dXJuIHtlcnJvcjogc2NvcGUuX2Vycm9yfTtcbiAgICB9XG4gICAgcmV0dXJuIHRvVmFsdWUoaGFuZGxlcnNbdG9rZW4udHlwZV0odG9rZW4sIHNjb3BlKSwgc2NvcGUpO1xufVxuXG5mdW5jdGlvbiBleGVjdXRlKHRva2Vucywgc2NvcGUsIGRlYnVnKXtcbiAgICBzY29wZSA9IHNjb3BlIGluc3RhbmNlb2YgU2NvcGUgPyBzY29wZSA6IG5ldyBTY29wZShzY29wZSwgZGVidWcpO1xuXG4gICAgdmFyIHJlc3VsdDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuXG4gICAgICAgIHJlc3VsdCA9IGV4ZWN1dGVUb2tlbih0b2tlbnNbaV0sIHNjb3BlKTtcblxuICAgICAgICBpZihyZXN1bHQuZXJyb3Ipe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKCFyZXN1bHQpe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZXJyb3I6IG5ldyBFcnJvcignVW5rbm93biBleGVjdXRpb24gZXJyb3InKVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZXhlY3V0ZTsiLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBsb2c6IGZ1bmN0aW9uKHgpe1xuICAgICAgICBjb25zb2xlLmxvZy5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpO1xuICAgICAgICByZXR1cm4geDtcbiAgICB9LFxuICAgIHNsaWNlOiBmdW5jdGlvbihpdGVtcywgc3RhcnQsIGVuZCl7XG4gICAgICAgIHJldHVybiBpdGVtcy5zbGljZShzdGFydCwgZW5kKTtcbiAgICB9LFxuICAgIGZpbmQ6IGZ1bmN0aW9uKGl0ZW1zLCBmbil7XG4gICAgICAgIHJldHVybiBpdGVtcy5maW5kKGZuKTtcbiAgICB9LFxuICAgIGluZGV4T2Y6IGZ1bmN0aW9uKGl0ZW1zLCB2YWx1ZSl7XG4gICAgICAgIHJldHVybiBpdGVtcy5pbmRleE9mKHZhbHVlKTtcbiAgICB9LFxuICAgIG1hcDogZnVuY3Rpb24oaXRlbXMsIGZuKXtcbiAgICAgICAgcmV0dXJuIGl0ZW1zLm1hcChmbik7XG4gICAgfSxcbiAgICBmb2xkOiBmdW5jdGlvbihpdGVtcywgc2VlZCwgZm4pe1xuICAgICAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAyKXtcbiAgICAgICAgICAgIHJldHVybiBpdGVtcy5yZWR1Y2Uoc2VlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGl0ZW1zLnJlZHVjZShmbiwgc2VlZCk7XG4gICAgfSxcbiAgICBTdHJpbmc6IFN0cmluZyxcbiAgICBOdW1iZXI6IE51bWJlcixcbiAgICBtYXRoOiBNYXRoXG59OyIsInZhciBvcGVyYXRvcnMgPSByZXF1aXJlKCcuL29wZXJhdG9ycycpO1xuXG5mdW5jdGlvbiBsZXhTdHJpbmcoc291cmNlKXtcbiAgICB2YXIgc3RyaW5nTWF0Y2ggPSBzb3VyY2UubWF0Y2goL14oKFtcIiddKSg/OlteXFxcXF18XFxcXC4pKj9cXDIpLyk7XG5cbiAgICBpZihzdHJpbmdNYXRjaCl7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHN0cmluZ0NoYXI6IHN0cmluZ01hdGNoWzFdLmNoYXJBdCgwKSxcbiAgICAgICAgICAgIHNvdXJjZTogc3RyaW5nTWF0Y2hbMV0ucmVwbGFjZSgvXFxcXCguKS9nLCBcIiQxXCIpLFxuICAgICAgICAgICAgbGVuZ3RoOiBzdHJpbmdNYXRjaFsxXS5sZW5ndGhcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleFdvcmQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL14oPyFcXC0pW1xcdy0kXSsvKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZihtYXRjaCBpbiBvcGVyYXRvcnMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ3dvcmQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGxleE51bWJlcihzb3VyY2Upe1xuICAgIHZhciBzcGVjaWFscyA9IHtcbiAgICAgICAgJ05hTic6IE51bWJlci5OYU4sXG4gICAgICAgICdJbmZpbml0eSc6IEluZmluaXR5XG4gICAgfTtcblxuICAgIHZhciB0b2tlbiA9IHtcbiAgICAgICAgdHlwZTogJ251bWJlcidcbiAgICB9O1xuXG4gICAgZm9yICh2YXIga2V5IGluIHNwZWNpYWxzKSB7XG4gICAgICAgIGlmIChzb3VyY2Uuc2xpY2UoMCwga2V5Lmxlbmd0aCkgPT09IGtleSkge1xuICAgICAgICAgICAgdG9rZW4uc291cmNlID0ga2V5O1xuICAgICAgICAgICAgdG9rZW4ubGVuZ3RoID0gdG9rZW4uc291cmNlLmxlbmd0aDtcblxuICAgICAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIG1hdGNoRXhwb25lbnQgPSBzb3VyY2UubWF0Y2goL15bMC05XSsoPzpcXC5bMC05XSspP1tlRV0tP1swLTldKy8pO1xuXG4gICAgaWYobWF0Y2hFeHBvbmVudCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoRXhwb25lbnRbMF07XG4gICAgICAgIHRva2VuLmxlbmd0aCA9IHRva2VuLnNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH1cblxuICAgIHZhciBtYXRjaEhleCA9IHNvdXJjZS5tYXRjaCgvXjBbeFhdWzAtOV0rLyk7XG5cbiAgICBpZihtYXRjaEhleCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoSGV4WzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbiAgICB2YXIgbWF0Y2hIZWFkbGVzc0RlY2ltYWwgPSBzb3VyY2UubWF0Y2goL15cXC5bMC05XSsvKTtcblxuICAgIGlmKG1hdGNoSGVhZGxlc3NEZWNpbWFsKXtcbiAgICAgICAgdG9rZW4uc291cmNlID0gbWF0Y2hIZWFkbGVzc0RlY2ltYWxbMF07XG4gICAgICAgIHRva2VuLmxlbmd0aCA9IHRva2VuLnNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH1cblxuICAgIHZhciBtYXRjaE5vcm1hbERlY2ltYWwgPSBzb3VyY2UubWF0Y2goL15bMC05XSsoPzpcXC5bMC05XSspPy8pO1xuXG4gICAgaWYobWF0Y2hOb3JtYWxEZWNpbWFsKXtcbiAgICAgICAgdG9rZW4uc291cmNlID0gbWF0Y2hOb3JtYWxEZWNpbWFsWzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleENvbW1lbnQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL14oXFwvXFwqW15dKj9cXC8pLyk7XG5cbiAgICBpZighbWF0Y2gpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ2NvbW1lbnQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbnZhciBjaGFyYWN0ZXJzID0ge1xuICAgICcuJzogJ3BlcmlvZCcsXG4gICAgJzsnOiAnc2VtaWNvbG9uJyxcbiAgICAneyc6ICdicmFjZU9wZW4nLFxuICAgICd9JzogJ2JyYWNlQ2xvc2UnLFxuICAgICcoJzogJ3BhcmVudGhlc2lzT3BlbicsXG4gICAgJyknOiAncGFyZW50aGVzaXNDbG9zZScsXG4gICAgJ1snOiAnc3F1YXJlQnJhY2VPcGVuJyxcbiAgICAnXSc6ICdzcXVhcmVCcmFjZUNsb3NlJ1xufTtcblxuZnVuY3Rpb24gbGV4Q2hhcmFjdGVycyhzb3VyY2Upe1xuICAgIHZhciBuYW1lLFxuICAgICAgICBrZXk7XG5cbiAgICBmb3Ioa2V5IGluIGNoYXJhY3RlcnMpe1xuICAgICAgICBpZihzb3VyY2UuaW5kZXhPZihrZXkpID09PSAwKXtcbiAgICAgICAgICAgIG5hbWUgPSBjaGFyYWN0ZXJzW2tleV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKCFuYW1lKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6IG5hbWUsXG4gICAgICAgIHNvdXJjZToga2V5LFxuICAgICAgICBsZW5ndGg6IDFcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBsZXhPcGVyYXRvcnMoc291cmNlKXtcbiAgICB2YXIgb3BlcmF0b3IsXG4gICAgICAgIGtleTtcblxuICAgIGZvcihrZXkgaW4gb3BlcmF0b3JzKXtcbiAgICAgICAgaWYoc291cmNlLmluZGV4T2Yoa2V5KSA9PT0gMCl7XG4gICAgICAgICAgICBvcGVyYXRvciA9IG9wZXJhdG9yc1trZXldO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighb3BlcmF0b3Ipe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ29wZXJhdG9yJyxcbiAgICAgICAgc291cmNlOiBrZXksXG4gICAgICAgIGxlbmd0aDoga2V5Lmxlbmd0aFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGxleFNwcmVhZChzb3VyY2Upe1xuICAgIHZhciBtYXRjaCA9IHNvdXJjZS5tYXRjaCgvXlxcLlxcLlxcLi8pO1xuXG4gICAgaWYoIW1hdGNoKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdzcHJlYWQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGxleERlbGltaXRlcihzb3VyY2Upe1xuICAgIHZhciBtYXRjaCA9IHNvdXJjZS5tYXRjaCgvXltcXHNcXG5dKy8pO1xuXG4gICAgaWYoIW1hdGNoKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdkZWxpbWl0ZXInLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbnZhciBsZXhlcnMgPSBbXG4gICAgbGV4RGVsaW1pdGVyLFxuICAgIGxleENvbW1lbnQsXG4gICAgbGV4TnVtYmVyLFxuICAgIGxleFdvcmQsXG4gICAgbGV4T3BlcmF0b3JzLFxuICAgIGxleENoYXJhY3RlcnMsXG4gICAgbGV4U3RyaW5nLFxuICAgIGxleFNwcmVhZFxuXTtcblxuZnVuY3Rpb24gc2NhbkZvclRva2VuKHRva2VuaXNlcnMsIGV4cHJlc3Npb24pe1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdG9rZW5pc2Vycy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgdG9rZW4gPSB0b2tlbmlzZXJzW2ldKGV4cHJlc3Npb24pO1xuICAgICAgICBpZiAodG9rZW4pIHtcbiAgICAgICAgICAgIHJldHVybiB0b2tlbjtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gbGV4KHNvdXJjZSwgbWVtb2lzZWRUb2tlbnMpIHtcbiAgICB2YXIgc291cmNlUmVmID0ge1xuICAgICAgICBzb3VyY2U6IHNvdXJjZSxcbiAgICAgICAgdG9KU09OOiBmdW5jdGlvbigpe31cbiAgICB9O1xuXG4gICAgaWYoIXNvdXJjZSl7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBpZihtZW1vaXNlZFRva2VucyAmJiBtZW1vaXNlZFRva2Vuc1tzb3VyY2VdKXtcbiAgICAgICAgcmV0dXJuIG1lbW9pc2VkVG9rZW5zW3NvdXJjZV0uc2xpY2UoKTtcbiAgICB9XG5cbiAgICB2YXIgb3JpZ2luYWxTb3VyY2UgPSBzb3VyY2UsXG4gICAgICAgIHRva2VucyA9IFtdLFxuICAgICAgICB0b3RhbENoYXJzUHJvY2Vzc2VkID0gMCxcbiAgICAgICAgcHJldmlvdXNMZW5ndGg7XG5cbiAgICBkbyB7XG4gICAgICAgIHByZXZpb3VzTGVuZ3RoID0gc291cmNlLmxlbmd0aDtcblxuICAgICAgICB2YXIgdG9rZW47XG5cbiAgICAgICAgdG9rZW4gPSBzY2FuRm9yVG9rZW4obGV4ZXJzLCBzb3VyY2UpO1xuXG4gICAgICAgIGlmKHRva2VuKXtcbiAgICAgICAgICAgIHRva2VuLnNvdXJjZVJlZiA9IHNvdXJjZVJlZjtcbiAgICAgICAgICAgIHRva2VuLmluZGV4ID0gdG90YWxDaGFyc1Byb2Nlc3NlZDtcbiAgICAgICAgICAgIHNvdXJjZSA9IHNvdXJjZS5zbGljZSh0b2tlbi5sZW5ndGgpO1xuICAgICAgICAgICAgdG90YWxDaGFyc1Byb2Nlc3NlZCArPSB0b2tlbi5sZW5ndGg7XG4gICAgICAgICAgICB0b2tlbnMucHVzaCh0b2tlbik7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgaWYoc291cmNlLmxlbmd0aCA9PT0gcHJldmlvdXNMZW5ndGgpe1xuICAgICAgICAgICAgdGhyb3cgJ1N5bnRheCBlcnJvcjogVW5hYmxlIHRvIGRldGVybWluZSBuZXh0IHRva2VuIGluIHNvdXJjZTogJyArIHNvdXJjZS5zbGljZSgwLCAxMDApO1xuICAgICAgICB9XG5cbiAgICB9IHdoaWxlIChzb3VyY2UpO1xuXG4gICAgaWYobWVtb2lzZWRUb2tlbnMpe1xuICAgICAgICBtZW1vaXNlZFRva2Vuc1tvcmlnaW5hbFNvdXJjZV0gPSB0b2tlbnMuc2xpY2UoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdG9rZW5zO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGxleDsiLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgICAnZGVsZXRlJzoge1xuICAgICAgICB1bmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2RlbGV0ZScsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAyMFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnLi4uJzoge1xuICAgICAgICB1bmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3NwcmVhZCcsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxOVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnLi4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3JhbmdlJyxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDNcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJysnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2FkZCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgKyBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTNcbiAgICAgICAgfSxcbiAgICAgICAgdW5hcnk6e1xuICAgICAgICAgICAgbmFtZTogJ3Bvc2l0aXZlJyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICthKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJy0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3N1YnRyYWN0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAtIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxM1xuICAgICAgICB9LFxuICAgICAgICB1bmFyeTp7XG4gICAgICAgICAgICBuYW1lOiAnbmVnYXRpdmUnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gLWEoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnKic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnbXVsdGlwbHknLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICogYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICcvJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdkaXZpZGUnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIC8gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICclJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdyZW1haW5kZXInLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICUgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICdpbic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnaW4nLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIGluIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPT09Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdleGFjdGx5RXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID09PSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyE9PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnbm90RXhhY3RseUVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAhPT0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEwXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc9PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID09IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnIT0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ25vdEVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAhPSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz49Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdncmVhdGVyVGhhbk9yRXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID49IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPD0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2xlc3NUaGFuT3JFcXVhbCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPD0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDExXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc+Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdncmVhdGVyVGhhbicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJzwnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2xlc3NUaGFuJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA8IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnJiYnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2FuZCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgJiYgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDZcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ3x8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdvcicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgfHwgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyEnOiB7XG4gICAgICAgIHVuYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnbm90JyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICFhKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyYnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VBbmQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICYgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ14nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VYT3InLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIF4gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDhcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ3wnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VPcicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgfCBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogN1xuICAgICAgICB9XG4gICAgfSxcbiAgICAnfic6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlTm90JyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIH5hKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ3R5cGVvZic6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICd0eXBlb2YnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHlwZW9mIGEoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPDwnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VMZWZ0U2hpZnQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIDw8IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMlxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPj4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VSaWdodFNoaWZ0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA+PiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTJcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz4+Pic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnYml0d2lzZVVuc2lnbmVkUmlnaHRTaGlmdCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPj4+IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMlxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPyc6IHtcbiAgICAgICAgdHJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3Rlcm5hcnknLFxuICAgICAgICAgICAgdHJpbmFyeTogJ3R1cGxlJyxcbiAgICAgICAgICAgIGFzc29jaWF0aXZpdHk6ICdyaWdodCcsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICc6Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICd0dXBsZScsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAzXG4gICAgICAgIH1cbiAgICB9XG59OyIsInZhciBvcGVyYXRvcnMgPSByZXF1aXJlKCcuL29wZXJhdG9ycycpLFxuICAgIHRlbXBsYXRlID0gcmVxdWlyZSgnc3RyaW5nLXRlbXBsYXRlJyksXG4gICAgZXJyb3JUZW1wbGF0ZSA9ICdQYXJzZSBlcnJvcixcXG57bWVzc2FnZX0sXFxuQXQge2luZGV4fSBcIntzbmlwcGV0fVwiJyxcbiAgICBzbmlwcGV0VGVtcGxhdGUgPSAnLS0+ezB9PC0tJztcblxuZnVuY3Rpb24gcGFyc2VFcnJvcihtZXNzYWdlLCB0b2tlbil7XG4gICAgdmFyIHN0YXJ0ID0gTWF0aC5tYXgodG9rZW4uaW5kZXggLSA1MCwgMCksXG4gICAgICAgIGVycm9ySW5kZXggPSBNYXRoLm1pbig1MCwgdG9rZW4uaW5kZXgpLFxuICAgICAgICBzdXJyb3VuZGluZ1NvdXJjZSA9IHRva2VuLnNvdXJjZVJlZi5zb3VyY2Uuc2xpY2Uoc3RhcnQsIHRva2VuLmluZGV4ICsgNTApLFxuICAgICAgICBlcnJvck1lc3NhZ2UgPSB0ZW1wbGF0ZShlcnJvclRlbXBsYXRlLCB7XG4gICAgICAgICAgICBtZXNzYWdlOiBtZXNzYWdlLFxuICAgICAgICAgICAgaW5kZXg6IHRva2VuLmluZGV4LFxuICAgICAgICAgICAgc25pcHBldDogW1xuICAgICAgICAgICAgICAgIChzdGFydCA9PT0gMCA/ICcnIDogJy4uLlxcbicpLFxuICAgICAgICAgICAgICAgIHN1cnJvdW5kaW5nU291cmNlLnNsaWNlKDAsIGVycm9ySW5kZXgpLFxuICAgICAgICAgICAgICAgIHRlbXBsYXRlKHNuaXBwZXRUZW1wbGF0ZSwgc3Vycm91bmRpbmdTb3VyY2Uuc2xpY2UoZXJyb3JJbmRleCwgZXJyb3JJbmRleCsxKSksXG4gICAgICAgICAgICAgICAgc3Vycm91bmRpbmdTb3VyY2Uuc2xpY2UoZXJyb3JJbmRleCArIDEpICsgJycsXG4gICAgICAgICAgICAgICAgKHN1cnJvdW5kaW5nU291cmNlLmxlbmd0aCA8IDEwMCA/ICcnIDogJy4uLicpXG4gICAgICAgICAgICBdLmpvaW4oJycpXG4gICAgICAgIH0pO1xuXG4gICAgdGhyb3cgZXJyb3JNZXNzYWdlO1xufVxuXG5mdW5jdGlvbiBmaW5kTmV4dE5vbkRlbGltaXRlcih0b2tlbnMpe1xuICAgIHZhciByZXN1bHQ7XG5cbiAgICB3aGlsZShyZXN1bHQgPSB0b2tlbnMuc2hpZnQoKSl7XG4gICAgICAgIGlmKCFyZXN1bHQgfHwgcmVzdWx0LnR5cGUgIT09ICdkZWxpbWl0ZXInKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxhc3RUb2tlbk1hdGNoZXMoYXN0LCB0eXBlcywgcG9wKXtcbiAgICB2YXIgbGFzdFRva2VuID0gYXN0W2FzdC5sZW5ndGggLSAxXSxcbiAgICAgICAgbGFzdFRva2VuVHlwZSxcbiAgICAgICAgbWF0Y2hlZDtcblxuICAgIGlmKCFsYXN0VG9rZW4pe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGFzdFRva2VuVHlwZSA9IGxhc3RUb2tlbi50eXBlO1xuXG4gICAgZm9yICh2YXIgaSA9IHR5cGVzLmxlbmd0aC0xLCB0eXBlID0gdHlwZXNbaV07IGkgPj0gMDsgaS0tLCB0eXBlID0gdHlwZXNbaV0pIHtcbiAgICAgICAgaWYodHlwZSA9PT0gJyEnICsgbGFzdFRva2VuVHlwZSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZih0eXBlID09PSAnKicgfHwgdHlwZSA9PT0gbGFzdFRva2VuVHlwZSl7XG4gICAgICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKCFtYXRjaGVkKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKHBvcCl7XG4gICAgICAgIGFzdC5wb3AoKTtcbiAgICB9XG4gICAgcmV0dXJuIGxhc3RUb2tlbjtcbn1cblxuZnVuY3Rpb24gcGFyc2VJZGVudGlmaWVyKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ3dvcmQnKXtcbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ2lkZW50aWZpZXInLFxuICAgICAgICAgICAgbmFtZTogdG9rZW5zLnNoaWZ0KCkuc291cmNlXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlTnVtYmVyKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ251bWJlcicpe1xuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJzZUZsb2F0KHRva2Vucy5zaGlmdCgpLnNvdXJjZSlcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZnVuY3Rpb25DYWxsKHRhcmdldCwgY29udGVudCl7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ2Z1bmN0aW9uQ2FsbCcsXG4gICAgICAgIHRhcmdldDogdGFyZ2V0LFxuICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VQYXJlbnRoZXNpcyh0b2tlbnMsIGFzdCkge1xuICAgIGlmKHRva2Vuc1swXS50eXBlICE9PSAncGFyZW50aGVzaXNPcGVuJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgb3BlblRva2VuID0gdG9rZW5zWzBdLFxuICAgICAgICBwb3NpdGlvbiA9IDAsXG4gICAgICAgIG9wZW5zID0gMTtcblxuICAgIHdoaWxlKCsrcG9zaXRpb24sIHBvc2l0aW9uIDw9IHRva2Vucy5sZW5ndGggJiYgb3BlbnMpe1xuICAgICAgICBpZighdG9rZW5zW3Bvc2l0aW9uXSl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCdpbnZhbGlkIG5lc3RpbmcuIE5vIGNsb3NpbmcgdG9rZW4gd2FzIGZvdW5kJywgdG9rZW5zW3Bvc2l0aW9uLTFdKTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdwYXJlbnRoZXNpc09wZW4nKSB7XG4gICAgICAgICAgICBvcGVucysrO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ3BhcmVudGhlc2lzQ2xvc2UnKSB7XG4gICAgICAgICAgICBvcGVucy0tO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHRhcmdldCA9ICFvcGVuVG9rZW4uZGVsaW1pdGVyUHJlZml4ICYmIGxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJyonLCAnIXN0YXRlbWVudCcsICchb3BlcmF0b3InLCAnIXNldCddLCB0cnVlKSxcbiAgICAgICAgY29udGVudCA9IHBhcnNlKHRva2Vucy5zcGxpY2UoMCwgcG9zaXRpb24pLnNsaWNlKDEsLTEpKSxcbiAgICAgICAgYXN0Tm9kZTtcblxuICAgIGlmKHRhcmdldCl7XG4gICAgICAgIGFzdE5vZGUgPSBmdW5jdGlvbkNhbGwodGFyZ2V0LCBjb250ZW50KTtcbiAgICB9ZWxzZXtcbiAgICAgICAgYXN0Tm9kZSA9IHtcbiAgICAgICAgICAgIHR5cGU6ICdwYXJlbnRoZXNpc0dyb3VwJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBhc3QucHVzaChhc3ROb2RlKTtcblxuICAgIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBwYXJzZVBhcmFtZXRlcnMoZnVuY3Rpb25DYWxsKXtcbiAgICByZXR1cm4gZnVuY3Rpb25DYWxsLmNvbnRlbnQubWFwKGZ1bmN0aW9uKHRva2VuKXtcbiAgICAgICAgaWYodG9rZW4udHlwZSA9PT0gJ2lkZW50aWZpZXInIHx8ICh0b2tlbi5uYW1lID09PSAnc3ByZWFkJyAmJiB0b2tlbi5yaWdodC50eXBlID09PSAnaWRlbnRpZmllcicpKXtcbiAgICAgICAgICAgIHJldHVybiB0b2tlbjtcbiAgICAgICAgfVxuXG4gICAgICAgIHBhcnNlRXJyb3IoJ1VuZXhwZWN0ZWQgdG9rZW4gaW4gcGFyYW1ldGVyIGxpc3QnLCBmdW5jdGlvbkNhbGwpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBuYW1lZEZ1bmN0aW9uRXhwcmVzc2lvbihmdW5jdGlvbkNhbGwsIGNvbnRlbnQpe1xuICAgIGlmKGZ1bmN0aW9uQ2FsbC50YXJnZXQudHlwZSAhPT0gJ2lkZW50aWZpZXInKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdmdW5jdGlvbkV4cHJlc3Npb24nLFxuICAgICAgICBpZGVudGlmaWVyOiBmdW5jdGlvbkNhbGwudGFyZ2V0LFxuICAgICAgICBwYXJhbWV0ZXJzOiBwYXJzZVBhcmFtZXRlcnMoZnVuY3Rpb25DYWxsKSxcbiAgICAgICAgY29udGVudDogY29udGVudFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGFub255bW91c0Z1bmN0aW9uRXhwcmVzc2lvbihwYXJlbnRoZXNpc0dyb3VwLCBjb250ZW50KXtcbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZnVuY3Rpb25FeHByZXNzaW9uJyxcbiAgICAgICAgcGFyYW1ldGVyczogcGFyc2VQYXJhbWV0ZXJzKHBhcmVudGhlc2lzR3JvdXApLFxuICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCbG9jayh0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgIT09ICdicmFjZU9wZW4nKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwb3NpdGlvbiA9IDAsXG4gICAgICAgIG9wZW5zID0gMTtcblxuICAgIHdoaWxlKCsrcG9zaXRpb24sIHBvc2l0aW9uIDw9IHRva2Vucy5sZW5ndGggJiYgb3BlbnMpe1xuICAgICAgICBpZighdG9rZW5zW3Bvc2l0aW9uXSl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCdpbnZhbGlkIG5lc3RpbmcuIE5vIGNsb3NpbmcgdG9rZW4gd2FzIGZvdW5kJywgdG9rZW5zW3Bvc2l0aW9uLTFdKTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdicmFjZU9wZW4nKXtcbiAgICAgICAgICAgIG9wZW5zKys7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAnYnJhY2VDbG9zZScpe1xuICAgICAgICAgICAgb3BlbnMtLTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciB0YXJnZXRUb2tlbiA9IHRva2Vuc1swXSxcbiAgICAgICAgY29udGVudCA9IHBhcnNlKHRva2Vucy5zcGxpY2UoMCwgcG9zaXRpb24pLnNsaWNlKDEsLTEpKTtcblxuICAgIHZhciBmdW5jdGlvbkNhbGwgPSBsYXN0VG9rZW5NYXRjaGVzKGFzdCwgWydmdW5jdGlvbkNhbGwnXSwgdHJ1ZSksXG4gICAgICAgIHBhcmVudGhlc2lzR3JvdXAgPSBsYXN0VG9rZW5NYXRjaGVzKGFzdCwgWydwYXJlbnRoZXNpc0dyb3VwJ10sIHRydWUpLFxuICAgICAgICBhc3ROb2RlO1xuXG4gICAgaWYoZnVuY3Rpb25DYWxsKXtcbiAgICAgICAgYXN0Tm9kZSA9IG5hbWVkRnVuY3Rpb25FeHByZXNzaW9uKGZ1bmN0aW9uQ2FsbCwgY29udGVudCk7XG4gICAgfWVsc2UgaWYocGFyZW50aGVzaXNHcm91cCl7XG4gICAgICAgIGFzdE5vZGUgPSBhbm9ueW1vdXNGdW5jdGlvbkV4cHJlc3Npb24ocGFyZW50aGVzaXNHcm91cCwgY29udGVudCk7XG4gICAgfWVsc2V7XG4gICAgICAgIGFzdE5vZGUgPSB7XG4gICAgICAgICAgICB0eXBlOiAnYnJhY2VHcm91cCcsXG4gICAgICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgaWYoIWFzdE5vZGUpe1xuICAgICAgICBwYXJzZUVycm9yKCd1bmV4cGVjdGVkIHRva2VuLicsIHRhcmdldFRva2VuKTtcbiAgICB9XG5cbiAgICBhc3QucHVzaChhc3ROb2RlKTtcblxuICAgIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNldCh0b2tlbnMsIGFzdCkge1xuICAgIGlmKHRva2Vuc1swXS50eXBlICE9PSAnc3F1YXJlQnJhY2VPcGVuJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgb3BlblRva2VuID0gdG9rZW5zWzBdLFxuICAgICAgICBwb3NpdGlvbiA9IDAsXG4gICAgICAgIG9wZW5zID0gMTtcblxuICAgIHdoaWxlKCsrcG9zaXRpb24sIHBvc2l0aW9uIDw9IHRva2Vucy5sZW5ndGggJiYgb3BlbnMpe1xuICAgICAgICBpZighdG9rZW5zW3Bvc2l0aW9uXSl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCdpbnZhbGlkIG5lc3RpbmcuIE5vIGNsb3NpbmcgdG9rZW4gd2FzIGZvdW5kJywgdG9rZW5zW3Bvc2l0aW9uLTFdKTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdzcXVhcmVCcmFjZU9wZW4nKSB7XG4gICAgICAgICAgICBvcGVucysrO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ3NxdWFyZUJyYWNlQ2xvc2UnKSB7XG4gICAgICAgICAgICBvcGVucy0tO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIGNvbnRlbnQgPSBwYXJzZSh0b2tlbnMuc3BsaWNlKDAsIHBvc2l0aW9uKS5zbGljZSgxLC0xKSksXG4gICAgICAgIHRhcmdldCA9ICFvcGVuVG9rZW4uZGVsaW1pdGVyUHJlZml4ICYmIGxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJyonLCAnIWZ1bmN0aW9uRXhwcmVzc2lvbicsICchYnJhY2VHcm91cCcsICchc3RhdGVtZW50JywgJyFvcGVyYXRvciddLCB0cnVlKTtcblxuICAgIGlmKHRhcmdldCl7XG4gICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdhY2Nlc3NvcicsXG4gICAgICAgICAgICB0YXJnZXQ6IHRhcmdldCxcbiAgICAgICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgYXN0LnB1c2goe1xuICAgICAgICB0eXBlOiAnc2V0JyxcbiAgICAgICAgY29udGVudDogY29udGVudFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRydWU7XG59XG5cblxuZnVuY3Rpb24gcGFyc2VEZWxpbWl0ZXJzKHRva2Vucyl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdkZWxpbWl0ZXInKXtcbiAgICAgICAgdG9rZW5zLnNwbGljZSgwLDEpO1xuICAgICAgICBpZih0b2tlbnNbMF0pe1xuICAgICAgICAgICAgdG9rZW5zWzBdLmRlbGltaXRlclByZWZpeCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZUNvbW1lbnRzKHRva2Vucyl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdjb21tZW50Jyl7XG4gICAgICAgIHRva2Vucy5zaGlmdCgpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlT3BlcmF0b3IodG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnb3BlcmF0b3InKXtcbiAgICAgICAgdmFyIHRva2VuID0gdG9rZW5zLnNoaWZ0KCksXG4gICAgICAgICAgICBvcGVyYXRvcnNGb3JTb3VyY2UgPSBvcGVyYXRvcnNbdG9rZW4uc291cmNlXSxcbiAgICAgICAgICAgIHN0YXJ0T2ZTdGF0ZW1lbnQgPSAhbGFzdFRva2VuTWF0Y2hlcyhhc3QsIFsnKicsICchc3RhdGVtZW50JywgJyFvcGVyYXRvciddKTtcblxuICAgICAgICBpZihvcGVyYXRvcnNGb3JTb3VyY2UuYmluYXJ5ICYmICFzdGFydE9mU3RhdGVtZW50ICYmXG4gICAgICAgICAgICAhKFxuICAgICAgICAgICAgICAgIG9wZXJhdG9yc0ZvclNvdXJjZS51bmFyeSAmJlxuICAgICAgICAgICAgICAgIChcbiAgICAgICAgICAgICAgICAgICAgdG9rZW4uZGVsaW1pdGVyUHJlZml4ICYmXG4gICAgICAgICAgICAgICAgICAgIHRva2Vuc1swXS50eXBlICE9PSAnZGVsaW1pdGVyJ1xuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgIClcbiAgICAgICAgKXtcbiAgICAgICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlcmF0b3InLFxuICAgICAgICAgICAgICAgIG5hbWU6IG9wZXJhdG9yc0ZvclNvdXJjZS5iaW5hcnkubmFtZSxcbiAgICAgICAgICAgICAgICBvcGVyYXRvcjogb3BlcmF0b3JzRm9yU291cmNlLmJpbmFyeSxcbiAgICAgICAgICAgICAgICBzb3VyY2VSZWY6IHRva2VuLnNvdXJjZVJlZixcbiAgICAgICAgICAgICAgICBpbmRleDogdG9rZW4uaW5kZXhcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvcGVyYXRvcnNGb3JTb3VyY2UudW5hcnkpe1xuICAgICAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgICAgICAgICAgbmFtZTogb3BlcmF0b3JzRm9yU291cmNlLnVuYXJ5Lm5hbWUsXG4gICAgICAgICAgICAgICAgb3BlcmF0b3I6IG9wZXJhdG9yc0ZvclNvdXJjZS51bmFyeSxcbiAgICAgICAgICAgICAgICBzb3VyY2VSZWY6IHRva2VuLnNvdXJjZVJlZixcbiAgICAgICAgICAgICAgICBpbmRleDogdG9rZW4uaW5kZXhcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmKG9wZXJhdG9yc0ZvclNvdXJjZS50cmluYXJ5ICYmICFzdGFydE9mU3RhdGVtZW50KXtcbiAgICAgICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlcmF0b3InLFxuICAgICAgICAgICAgICAgIG5hbWU6IG9wZXJhdG9yc0ZvclNvdXJjZS50cmluYXJ5Lm5hbWUsXG4gICAgICAgICAgICAgICAgb3BlcmF0b3I6IG9wZXJhdG9yc0ZvclNvdXJjZS50cmluYXJ5LFxuICAgICAgICAgICAgICAgIHNvdXJjZVJlZjogdG9rZW4uc291cmNlUmVmLFxuICAgICAgICAgICAgICAgIGluZGV4OiB0b2tlbi5pbmRleFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHBhcnNlRXJyb3IoJ1VuZXhwZWN0ZWQgdG9rZW4nLCB0b2tlbik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVBlcmlvZCh0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdwZXJpb2QnKXtcbiAgICAgICAgdmFyIHRva2VuID0gdG9rZW5zLnNoaWZ0KCksXG4gICAgICAgICAgICByaWdodCA9IGZpbmROZXh0Tm9uRGVsaW1pdGVyKHRva2Vucyk7XG5cbiAgICAgICAgaWYoIXJpZ2h0KXtcbiAgICAgICAgICAgIHJldHVybiBwYXJzZUVycm9yKCdVbmV4cGVjdGVkIHRva2VuJywgdG9rZW4pO1xuICAgICAgICB9XG5cbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ3BlcmlvZCcsXG4gICAgICAgICAgICBsZWZ0OiBhc3QucG9wKCksXG4gICAgICAgICAgICByaWdodDogcGFyc2VUb2tlbihbcmlnaHRdKS5wb3AoKVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlU3RyaW5nKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ3N0cmluZycpe1xuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHZhbHVlOiB0b2tlbnMuc2hpZnQoKS5zb3VyY2Uuc2xpY2UoMSwtMSlcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VTZW1pY29sb24odG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnc2VtaWNvbG9uJyl7XG4gICAgICAgIHRva2Vucy5zaGlmdCgpO1xuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAnc3RhdGVtZW50JyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IFthc3QucG9wKCldXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbnZhciBwYXJzZXJzID0gW1xuICAgIHBhcnNlRGVsaW1pdGVycyxcbiAgICBwYXJzZUNvbW1lbnRzLFxuICAgIHBhcnNlTnVtYmVyLFxuICAgIHBhcnNlU3RyaW5nLFxuICAgIHBhcnNlSWRlbnRpZmllcixcbiAgICBwYXJzZVBlcmlvZCxcbiAgICBwYXJzZVBhcmVudGhlc2lzLFxuICAgIHBhcnNlU2V0LFxuICAgIHBhcnNlQmxvY2ssXG4gICAgcGFyc2VPcGVyYXRvcixcbiAgICBwYXJzZVNlbWljb2xvblxuXTtcblxuZnVuY3Rpb24gcGFyc2VPcGVyYXRvcnMoYXN0KXtcbiAgICBhc3QuZmlsdGVyKGZ1bmN0aW9uKHRva2VuKXtcbiAgICAgICAgcmV0dXJuIHRva2VuLnR5cGUgPT09ICdvcGVyYXRvcic7XG4gICAgfSlcbiAgICAuc29ydChmdW5jdGlvbihhLGIpe1xuICAgICAgICBpZihhLm9wZXJhdG9yLnByZWNlZGVuY2UgPT09IGIub3BlcmF0b3IucHJlY2VkZW5jZSAmJiBhLm9wZXJhdG9yLmFzc29jaWF0aXZpdHkgPT09ICdyaWdodCcpe1xuICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYi5vcGVyYXRvci5wcmVjZWRlbmNlIC0gYS5vcGVyYXRvci5wcmVjZWRlbmNlO1xuICAgIH0pXG4gICAgLmZvckVhY2goZnVuY3Rpb24odG9rZW4pe1xuICAgICAgICB2YXIgaW5kZXggPSBhc3QuaW5kZXhPZih0b2tlbiksXG4gICAgICAgICAgICBvcGVyYXRvciA9IHRva2VuLm9wZXJhdG9yLFxuICAgICAgICAgICAgbGVmdCxcbiAgICAgICAgICAgIG1pZGRsZSxcbiAgICAgICAgICAgIHJpZ2h0O1xuXG4gICAgICAgIC8vIFRva2VuIHdhcyBwYXJzZWQgYnkgc29tZSBvdGhlciBwYXJzZXIgc3RlcC5cbiAgICAgICAgaWYoIX5pbmRleCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihvcGVyYXRvci50cmluYXJ5KXtcbiAgICAgICAgICAgIGxlZnQgPSBhc3Quc3BsaWNlKGluZGV4LTEsMSk7XG4gICAgICAgICAgICBtaWRkbGUgPSBhc3Quc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICAgICAgdmFyIHRyaW5hcnkgPSBhc3Quc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICAgICAgcmlnaHQgPSBhc3Quc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICAgICAgaWYoIXRyaW5hcnkubGVuZ3RoIHx8IHRyaW5hcnlbMF0ubmFtZSAhPT0gb3BlcmF0b3IudHJpbmFyeSl7XG4gICAgICAgICAgICAgICAgcGFyc2VFcnJvcignVW5leHBlY3RlZCB0b2tlbi4nLCB0b2tlbik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1lbHNlIGlmKG9wZXJhdG9yLmRpcmVjdGlvbiA9PT0gJ2xlZnQnKXtcbiAgICAgICAgICAgIGxlZnQgPSBhc3Quc3BsaWNlKGluZGV4LTEsMSk7XG4gICAgICAgIH1lbHNlIGlmKG9wZXJhdG9yLmRpcmVjdGlvbiA9PT0gJ3JpZ2h0Jyl7XG4gICAgICAgICAgICByaWdodCA9IGFzdC5zcGxpY2UoaW5kZXggKyAxLDEpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGxlZnQgPSBhc3Quc3BsaWNlKGluZGV4LTEsMSk7XG4gICAgICAgICAgICByaWdodCA9IGFzdC5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoXG4gICAgICAgICAgICBsZWZ0ICYmIGxlZnQubGVuZ3RoICE9PSAxIHx8XG4gICAgICAgICAgICBtaWRkbGUgJiYgbWlkZGxlLmxlbmd0aCAhPT0gMSB8fFxuICAgICAgICAgICAgcmlnaHQgJiYgcmlnaHQubGVuZ3RoICE9PSAxXG4gICAgICAgICl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCd1bmV4cGVjdGVkIHRva2VuLicsIHRva2VuKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGxlZnQpe1xuICAgICAgICAgICAgdG9rZW4ubGVmdCA9IGxlZnRbMF07XG4gICAgICAgIH1cbiAgICAgICAgaWYobWlkZGxlKXtcbiAgICAgICAgICAgIHRva2VuLm1pZGRsZSA9IG1pZGRsZVswXTtcbiAgICAgICAgfVxuICAgICAgICBpZihyaWdodCl7XG4gICAgICAgICAgICB0b2tlbi5yaWdodCA9IHJpZ2h0WzBdO1xuICAgICAgICB9XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVG9rZW4odG9rZW5zLCBhc3Qpe1xuICAgIGlmKCFhc3Qpe1xuICAgICAgICBhc3QgPSBbXTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDw9IHBhcnNlcnMubGVuZ3RoICYmIHRva2Vucy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKGkgPT09IHBhcnNlcnMubGVuZ3RoICYmIHRva2Vucy5sZW5ndGgpe1xuICAgICAgICAgICAgcGFyc2VFcnJvcigndW5rbm93biB0b2tlbicsIHRva2Vuc1swXSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihwYXJzZXJzW2ldKHRva2VucywgYXN0KSl7XG4gICAgICAgICAgICByZXR1cm4gYXN0O1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZSh0b2tlbnMsIG11dGF0ZSl7XG4gICAgdmFyIGFzdCA9IFtdO1xuXG4gICAgaWYoIW11dGF0ZSl7XG4gICAgICAgIHRva2VucyA9IHRva2Vucy5zbGljZSgpO1xuICAgIH1cblxuICAgIHdoaWxlKHRva2Vucy5sZW5ndGgpe1xuICAgICAgICBwYXJzZVRva2VuKHRva2VucywgYXN0KTtcbiAgICB9XG5cbiAgICBwYXJzZU9wZXJhdG9ycyhhc3QpO1xuXG4gICAgcmV0dXJuIGFzdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBwYXJzZTsiLCJ2YXIgdG9WYWx1ZSA9IHJlcXVpcmUoJy4vdG9WYWx1ZScpO1xuXG5mdW5jdGlvbiB3cmFwU2NvcGUoX19zY29wZV9fKXtcbiAgICB2YXIgc2NvcGUgPSBuZXcgU2NvcGUoKTtcbiAgICBzY29wZS5fX3Njb3BlX18gPSBfX3Njb3BlX187XG4gICAgcmV0dXJuIHNjb3BlO1xufVxuXG5mdW5jdGlvbiBTY29wZShvbGRTY29wZSwgZGVidWcpe1xuICAgIHRoaXMuX19zY29wZV9fID0ge307XG4gICAgdGhpcy5fZGVidWcgPSBkZWJ1ZztcbiAgICBpZihvbGRTY29wZSl7XG4gICAgICAgIHRoaXMuX19vdXRlclNjb3BlX18gPSBvbGRTY29wZSBpbnN0YW5jZW9mIFNjb3BlID8gb2xkU2NvcGUgOiB3cmFwU2NvcGUob2xkU2NvcGUpO1xuICAgICAgICB0aGlzLl9kZWJ1ZyA9IHRoaXMuX19vdXRlclNjb3BlX18uX2RlYnVnO1xuICAgIH1cbn1cblNjb3BlLnByb3RvdHlwZS50aHJvdyA9IGZ1bmN0aW9uKG1lc3NhZ2Upe1xuICAgIHRoaXMuX2Vycm9yID0gbmV3IEVycm9yKCdQcmVzaCBleGVjdXRpb24gZXJyb3I6ICcgKyBtZXNzYWdlKTtcbiAgICB0aGlzLl9lcnJvci5zY29wZSA9IHRoaXM7XG59O1xuU2NvcGUucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGtleSl7XG4gICAgdmFyIHNjb3BlID0gdGhpcztcbiAgICB3aGlsZShzY29wZSAmJiAhc2NvcGUuX19zY29wZV9fLmhhc093blByb3BlcnR5KGtleSkpe1xuICAgICAgICBzY29wZSA9IHNjb3BlLl9fb3V0ZXJTY29wZV9fO1xuICAgIH1cbiAgICByZXR1cm4gc2NvcGUgJiYgdG9WYWx1ZS52YWx1ZShzY29wZS5fX3Njb3BlX19ba2V5XSwgdGhpcyk7XG59O1xuU2NvcGUucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUsIGJ1YmJsZSl7XG4gICAgaWYoYnViYmxlKXtcbiAgICAgICAgdmFyIGN1cnJlbnRTY29wZSA9IHRoaXM7XG4gICAgICAgIHdoaWxlKGN1cnJlbnRTY29wZSAmJiAhKGtleSBpbiBjdXJyZW50U2NvcGUuX19zY29wZV9fKSl7XG4gICAgICAgICAgICBjdXJyZW50U2NvcGUgPSBjdXJyZW50U2NvcGUuX19vdXRlclNjb3BlX187XG4gICAgICAgIH1cblxuICAgICAgICBpZihjdXJyZW50U2NvcGUpe1xuICAgICAgICAgICAgY3VycmVudFNjb3BlLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICB0aGlzLl9fc2NvcGVfX1trZXldID0gdG9WYWx1ZSh2YWx1ZSwgdGhpcyk7XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuU2NvcGUucHJvdG90eXBlLmRlZmluZSA9IGZ1bmN0aW9uKG9iail7XG4gICAgZm9yKHZhciBrZXkgaW4gb2JqKXtcbiAgICAgICAgdGhpcy5fX3Njb3BlX19ba2V5XSA9IHRvVmFsdWUob2JqW2tleV0sIHRoaXMpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbn07XG5TY29wZS5wcm90b3R5cGUuaXNEZWZpbmVkID0gZnVuY3Rpb24oa2V5KXtcbiAgICBpZihrZXkgaW4gdGhpcy5fX3Njb3BlX18pe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX19vdXRlclNjb3BlX18gJiYgdGhpcy5fX291dGVyU2NvcGVfXy5pc0RlZmluZWQoa2V5KSB8fCBmYWxzZTtcbn07XG5TY29wZS5wcm90b3R5cGUuaGFzRXJyb3IgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiB0aGlzLl9lcnJvcjtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NvcGU7IiwidmFyIHYgPSB7fTtcblxuZnVuY3Rpb24gaXNWYWx1ZSh2YWx1ZSl7XG4gICAgcmV0dXJuIHZhbHVlICYmIHZhbHVlLl92YWx1ZSA9PT0gdjtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiB0b1ZhbHVlKHZhbHVlLCBzY29wZSwgY29udGV4dCl7XG4gICAgaWYoc2NvcGUuX2Vycm9yKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGVycm9yOiBzY29wZS5fZXJyb3JcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBpZihpc1ZhbHVlKHZhbHVlKSl7XG4gICAgICAgIGlmKHR5cGVvZiBjb250ZXh0ID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgY29udGV4dCA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgICAgICB2YWx1ZS5jb250ZXh0ID0gY29udGV4dDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ3ZhbHVlJyxcbiAgICAgICAgY29udGV4dDogY29udGV4dCxcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICBfdmFsdWU6IHZcbiAgICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNWYWx1ZSA9IGlzVmFsdWU7XG5cbm1vZHVsZS5leHBvcnRzLnZhbHVlID0gZnVuY3Rpb24odmFsdWUpe1xuICAgIHJldHVybiBpc1ZhbHVlKHZhbHVlKSA/IHZhbHVlLnZhbHVlIDogdmFsdWU7XG59OyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNTYW1lKGEsIGIpe1xuICAgIGlmKGEgPT09IGIpe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZihcbiAgICAgICAgdHlwZW9mIGEgIT09IHR5cGVvZiBiIHx8XG4gICAgICAgIHR5cGVvZiBhID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAhKGEgaW5zdGFuY2VvZiBEYXRlICYmIGIgaW5zdGFuY2VvZiBEYXRlKVxuICAgICl7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICByZXR1cm4gU3RyaW5nKGEpID09PSBTdHJpbmcoYik7XG59OyIsInZhciBuYXR1cmFsU2VsZWN0aW9uID0gcmVxdWlyZSgnbmF0dXJhbC1zZWxlY3Rpb24nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XG4gICAgdmFyIGNhblNldCA9IG5hdHVyYWxTZWxlY3Rpb24oZWxlbWVudCkgJiYgZWxlbWVudCA9PT0gZG9jdW1lbnQuYWN0aXZlRWxlbWVudDtcblxuICAgIGlmIChjYW5TZXQpIHtcbiAgICAgICAgdmFyIHN0YXJ0ID0gZWxlbWVudC5zZWxlY3Rpb25TdGFydCxcbiAgICAgICAgICAgIGVuZCA9IGVsZW1lbnQuc2VsZWN0aW9uRW5kO1xuXG4gICAgICAgIGVsZW1lbnQudmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgZWxlbWVudC5zZXRTZWxlY3Rpb25SYW5nZShzdGFydCwgZW5kKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBlbGVtZW50LnZhbHVlID0gdmFsdWU7XG4gICAgfVxufTtcbiIsIid1c2Ugc3RyaWN0J1xuLyogZXNsaW50IG5vLXByb3RvOiAwICovXG5tb2R1bGUuZXhwb3J0cyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fCAoeyBfX3Byb3RvX186IFtdIH0gaW5zdGFuY2VvZiBBcnJheSA/IHNldFByb3RvT2YgOiBtaXhpblByb3BlcnRpZXMpXG5cbmZ1bmN0aW9uIHNldFByb3RvT2YgKG9iaiwgcHJvdG8pIHtcbiAgb2JqLl9fcHJvdG9fXyA9IHByb3RvXG4gIHJldHVybiBvYmpcbn1cblxuZnVuY3Rpb24gbWl4aW5Qcm9wZXJ0aWVzIChvYmosIHByb3RvKSB7XG4gIGZvciAodmFyIHByb3AgaW4gcHJvdG8pIHtcbiAgICBpZiAoIW9iai5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgICAgb2JqW3Byb3BdID0gcHJvdG9bcHJvcF1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG9ialxufVxuIiwidmFyIG5hcmdzID0gL1xceyhbMC05YS16QS1aXSspXFx9L2dcbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZVxuXG5tb2R1bGUuZXhwb3J0cyA9IHRlbXBsYXRlXG5cbmZ1bmN0aW9uIHRlbXBsYXRlKHN0cmluZykge1xuICAgIHZhciBhcmdzXG5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMiAmJiB0eXBlb2YgYXJndW1lbnRzWzFdID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIGFyZ3MgPSBhcmd1bWVudHNbMV1cbiAgICB9IGVsc2Uge1xuICAgICAgICBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgfVxuXG4gICAgaWYgKCFhcmdzIHx8ICFhcmdzLmhhc093blByb3BlcnR5KSB7XG4gICAgICAgIGFyZ3MgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZShuYXJncywgZnVuY3Rpb24gcmVwbGFjZUFyZyhtYXRjaCwgaSwgaW5kZXgpIHtcbiAgICAgICAgdmFyIHJlc3VsdFxuXG4gICAgICAgIGlmIChzdHJpbmdbaW5kZXggLSAxXSA9PT0gXCJ7XCIgJiZcbiAgICAgICAgICAgIHN0cmluZ1tpbmRleCArIG1hdGNoLmxlbmd0aF0gPT09IFwifVwiKSB7XG4gICAgICAgICAgICByZXR1cm4gaVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzdWx0ID0gYXJncy5oYXNPd25Qcm9wZXJ0eShpKSA/IGFyZ3NbaV0gOiBudWxsXG4gICAgICAgICAgICBpZiAocmVzdWx0ID09PSBudWxsIHx8IHJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFwiXCJcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgICB9XG4gICAgfSlcbn1cbiIsInZhciBjbG9uZSA9IHJlcXVpcmUoJ2Nsb25lJyksXG4gICAgZGVlcEVxdWFsID0gcmVxdWlyZSgnY3ljbGljLWRlZXAtZXF1YWwnKTtcblxuZnVuY3Rpb24ga2V5c0FyZURpZmZlcmVudChrZXlzMSwga2V5czIpe1xuICAgIGlmKGtleXMxID09PSBrZXlzMil7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYoIWtleXMxIHx8ICFrZXlzMiB8fCBrZXlzMS5sZW5ndGggIT09IGtleXMyLmxlbmd0aCl7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwga2V5czEubGVuZ3RoOyBpKyspe1xuICAgICAgICBpZihrZXlzMVtpXSAhPT0ga2V5czJbaV0pe1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldEtleXModmFsdWUpe1xuICAgIGlmKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIFdoYXRDaGFuZ2VkKHZhbHVlLCBjaGFuZ2VzVG9UcmFjayl7XG4gICAgdGhpcy5fY2hhbmdlc1RvVHJhY2sgPSB7fTtcblxuICAgIGlmKGNoYW5nZXNUb1RyYWNrID09IG51bGwpe1xuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9ICd2YWx1ZSB0eXBlIGtleXMgc3RydWN0dXJlIHJlZmVyZW5jZSc7XG4gICAgfVxuXG4gICAgaWYodHlwZW9mIGNoYW5nZXNUb1RyYWNrICE9PSAnc3RyaW5nJyl7XG4gICAgICAgIHRocm93ICdjaGFuZ2VzVG9UcmFjayBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJztcbiAgICB9XG5cbiAgICBjaGFuZ2VzVG9UcmFjayA9IGNoYW5nZXNUb1RyYWNrLnNwbGl0KCcgJyk7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYW5nZXNUb1RyYWNrLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMuX2NoYW5nZXNUb1RyYWNrW2NoYW5nZXNUb1RyYWNrW2ldXSA9IHRydWU7XG4gICAgfTtcblxuICAgIHRoaXMudXBkYXRlKHZhbHVlKTtcbn1cbldoYXRDaGFuZ2VkLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9LFxuICAgICAgICBjaGFuZ2VzVG9UcmFjayA9IHRoaXMuX2NoYW5nZXNUb1RyYWNrLFxuICAgICAgICBuZXdLZXlzID0gZ2V0S2V5cyh2YWx1ZSk7XG5cbiAgICBpZigndmFsdWUnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlKycnICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKycnKXtcbiAgICAgICAgcmVzdWx0LnZhbHVlID0gdHJ1ZTtcbiAgICAgICAgcmVzdWx0LmFueSA9IHRydWU7XG4gICAgfVxuICAgIGlmKFxuICAgICAgICAndHlwZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgdHlwZW9mIHZhbHVlICE9PSB0eXBlb2YgdGhpcy5fbGFzdFZhbHVlIHx8XG4gICAgICAgICh2YWx1ZSA9PT0gbnVsbCB8fCB0aGlzLl9sYXN0VmFsdWUgPT09IG51bGwpICYmIHRoaXMudmFsdWUgIT09IHRoaXMuX2xhc3RWYWx1ZSAvLyB0eXBlb2YgbnVsbCA9PT0gJ29iamVjdCdcbiAgICApe1xuICAgICAgICByZXN1bHQudHlwZSA9IHRydWU7XG4gICAgICAgIHJlc3VsdC5hbnkgPSB0cnVlO1xuICAgIH1cbiAgICBpZigna2V5cycgaW4gY2hhbmdlc1RvVHJhY2sgJiYga2V5c0FyZURpZmZlcmVudCh0aGlzLl9sYXN0S2V5cywgZ2V0S2V5cyh2YWx1ZSkpKXtcbiAgICAgICAgcmVzdWx0LmtleXMgPSB0cnVlO1xuICAgICAgICByZXN1bHQuYW55ID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZih2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnIHx8IHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHZhciBsYXN0VmFsdWUgPSB0aGlzLl9sYXN0VmFsdWU7XG5cbiAgICAgICAgaWYoJ3NoYWxsb3dTdHJ1Y3R1cmUnIGluIGNoYW5nZXNUb1RyYWNrICYmICghbGFzdFZhbHVlIHx8IHR5cGVvZiBsYXN0VmFsdWUgIT09ICdvYmplY3QnIHx8IE9iamVjdC5rZXlzKHZhbHVlKS5zb21lKGZ1bmN0aW9uKGtleSwgaW5kZXgpe1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlW2tleV0gIT09IGxhc3RWYWx1ZVtrZXldO1xuICAgICAgICB9KSkpe1xuICAgICAgICAgICAgcmVzdWx0LnNoYWxsb3dTdHJ1Y3R1cmUgPSB0cnVlO1xuICAgICAgICAgICAgcmVzdWx0LmFueSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYoJ3N0cnVjdHVyZScgaW4gY2hhbmdlc1RvVHJhY2sgJiYgIWRlZXBFcXVhbCh2YWx1ZSwgbGFzdFZhbHVlKSl7XG4gICAgICAgICAgICByZXN1bHQuc3RydWN0dXJlID0gdHJ1ZTtcbiAgICAgICAgICAgIHJlc3VsdC5hbnkgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmKCdyZWZlcmVuY2UnIGluIGNoYW5nZXNUb1RyYWNrICYmIHZhbHVlICE9PSB0aGlzLl9sYXN0UmVmZXJlbmNlKXtcbiAgICAgICAgICAgIHJlc3VsdC5yZWZlcmVuY2UgPSB0cnVlO1xuICAgICAgICAgICAgcmVzdWx0LmFueSA9IHRydWU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9sYXN0VmFsdWUgPSAnc3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayA/IGNsb25lKHZhbHVlKSA6ICdzaGFsbG93U3RydWN0dXJlJyBpbiBjaGFuZ2VzVG9UcmFjayA/IGNsb25lKHZhbHVlLCB0cnVlLCAxKTogdmFsdWU7XG4gICAgdGhpcy5fbGFzdFJlZmVyZW5jZSA9IHZhbHVlO1xuICAgIHRoaXMuX2xhc3RLZXlzID0gbmV3S2V5cztcblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdoYXRDaGFuZ2VkOyIsInZhciBvcGVyYXRvclRva2VucyA9IHJlcXVpcmUoJ3ByZXNoL29wZXJhdG9ycycpO1xyXG52YXIgb3BlcmF0b3JNYXAgPSBPYmplY3Qua2V5cyhvcGVyYXRvclRva2VucykucmVkdWNlKGZ1bmN0aW9uKHJlc3VsdCwgb3BlcmF0b3JTb3VyY2Upe1xyXG4gICAgdmFyIG9wZXJhdG9ycyA9IG9wZXJhdG9yVG9rZW5zW29wZXJhdG9yU291cmNlXTtcclxuXHJcbiAgICBPYmplY3Qua2V5cyhvcGVyYXRvcnMpLmZvckVhY2gob3BlcmF0b3JUeXBlID0+IHtcclxuICAgICAgICB2YXIgb3BlcmF0b3IgPSBvcGVyYXRvcnNbb3BlcmF0b3JUeXBlXTtcclxuICAgICAgICByZXN1bHRbb3BlcmF0b3IubmFtZV0gPSBvcGVyYXRvcjtcclxuICAgICAgICByZXN1bHRbb3BlcmF0b3IubmFtZV0uc291cmNlID0gb3BlcmF0b3JTb3VyY2VcclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn0sIHt9KTtcclxudmFyIGxleCA9IHJlcXVpcmUoJ3ByZXNoL2xleCcpO1xyXG52YXIgcGFyc2UgPSByZXF1aXJlKCdwcmVzaC9wYXJzZScpO1xyXG52YXIgZXhlY3V0ZSA9IHJlcXVpcmUoJ3ByZXNoL2V4ZWN1dGUnKTtcclxudmFyIFNjb3BlID0gcmVxdWlyZSgncHJlc2gvc2NvcGUnKTtcclxudmFyIGdsb2JhbHMgPSByZXF1aXJlKCdwcmVzaC9nbG9iYWwnKTtcclxuXHJcbmZ1bmN0aW9uIGV4ZWN1dGVUb2tlbih0b2tlbiwgZGF0YSl7XHJcbiAgICBpZighdG9rZW4pe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgZXhlY3V0aW9uUmVzdWx0ID0gZXhlY3V0ZShbdG9rZW5dLCB7IC4uLmdsb2JhbHMsIC4uLmRhdGEuZ2xvYmFscyB9KTtcclxuICAgIGlmKGV4ZWN1dGlvblJlc3VsdC5lcnJvcil7XHJcbiAgICAgICAgcmV0dXJuIGV4ZWN1dGlvblJlc3VsdC5lcnJvcjtcclxuICAgIH1cclxuICAgIHZhciByZXN1bHQgPSBleGVjdXRpb25SZXN1bHQudmFsdWU7XHJcblxyXG4gICAgaWYoZGF0YS5yZXN1bHRUcmFuc2Zvcm0pe1xyXG4gICAgICAgIHJlc3VsdCA9IGRhdGEucmVzdWx0VHJhbnNmb3JtKHJlc3VsdCwgdG9rZW4sIHsgLi4uZ2xvYmFscywgLi4uZGF0YS5nbG9iYWxzIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRpdGxlQmluZGluZyhmYXN0biwgc2NvcGUsIHN0YXRpYyl7XHJcbiAgICBpZihzdGF0aWMpe1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHJldHVybiBmYXN0bi5iaW5kaW5nKCdpdGVtfCoqJywgZmFzdG4uYmluZGluZygnLnwqKicpLmF0dGFjaChzY29wZSksIGV4ZWN1dGVUb2tlbilcclxufVxyXG5cclxuZnVuY3Rpb24gb25Ob2RlSW5wdXQoYmluZGluZyl7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24oZXZlbnQsIHNjb3BlKXtcclxuICAgICAgICB2YXIgZXhpc3RpbmdOb2RlID0gc2NvcGUuZ2V0KCdpdGVtJyk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdmFyIG5ld05vZGUgPSBwYXJzZShsZXgoZXZlbnQudGFyZ2V0LnRleHRDb250ZW50KSlbMF07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgc2NvcGUuc2V0KCdpdGVtLmVycm9yJywgZXJyb3IpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGJpbmRpbmcobmV3Tm9kZSk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9uTm9kZUFjdGlvbihzY29wZSwgdG9rZW4pe1xyXG4gICAgcmV0dXJuIGZ1bmN0aW9uKGV2ZW50LCBjb21wb25lbnRTY29wZSkge1xyXG4gICAgICAgIHZhciBub2RlQWN0aW9uID0gc2NvcGUuZ2V0KCdub2RlQWN0aW9uJyk7XHJcbiAgICAgICAgaWYobm9kZUFjdGlvbil7XHJcbiAgICAgICAgICAgIG5vZGVBY3Rpb24oZXZlbnQsIHRoaXMsIGNvbXBvbmVudFNjb3BlLCB0b2tlbilcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckZ1bmN0aW9uRXhwcmVzc2lvbihmYXN0biwgc2NvcGUsIGJpbmRpbmcsIHN0YXRpYyl7XHJcbiAgICByZXR1cm4gZmFzdG4oJ3RlbXBsYXRlcicsIHtcclxuICAgICAgICBkYXRhOiBmYXN0bi5iaW5kaW5nKCdpdGVtJyksXHJcbiAgICAgICAgYXR0YWNoVGVtcGxhdGVzOiBmYWxzZSxcclxuICAgICAgICB0ZW1wbGF0ZTogKG1vZGVsKSA9PiB7XHJcbiAgICAgICAgICAgIHZhciB0b2tlbiA9IG1vZGVsLmdldCgnaXRlbScpO1xyXG5cclxuICAgICAgICAgICAgaWYoIXRva2VuKXtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCdkaXYnLFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOiAnbm9kZSBmdW5jdGlvbkV4cHJlc3Npb24nLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdDogdGl0bGVCaW5kaW5nKGZhc3RuLCBzY29wZSwgc3RhdGljKSxcclxuICAgICAgICAgICAgICAgICAgICAvL2NvbnRlbnRlZGl0YWJsZTogZmFzdG4uYmluZGluZygnZWRpdCcpLmF0dGFjaChzY29wZSlcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBmYXN0bi5iaW5kaW5nKCdpdGVtLmlkZW50aWZpZXIubmFtZScpLFxyXG4gICAgICAgICAgICAgICAgJygnLFxyXG4gICAgICAgICAgICAgICAgZmFzdG4oJ2xpc3Q6c3BhbicsIHtcclxuICAgICAgICAgICAgICAgICAgICBpdGVtczogZmFzdG4uYmluZGluZygnaXRlbS5wYXJhbWV0ZXJzJyksXHJcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6ICgpID0+IGZhc3RuKCdzcGFuJywgeyBjbGFzczogJ25vZGUgbGl0ZXJhbCcgfSwgZmFzdG4uYmluZGluZygnaXRlbS5uYW1lJykpXHJcbiAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICcpJyxcclxuICAgICAgICAgICAgICAgICd7JyxcclxuICAgICAgICAgICAgICAgIHJlbmRlck5vZGVMaXN0KGZhc3RuLCBzY29wZSwgdHJ1ZSkuYmluZGluZygnaXRlbScpLFxyXG4gICAgICAgICAgICAgICAgJ30nXHJcbiAgICAgICAgICAgIClcclxuICAgICAgICAgICAgLm9uKCdpbnB1dCcsIG9uTm9kZUlucHV0KGJpbmRpbmcpKVxyXG4gICAgICAgICAgICAub24oJ2NsaWNrJywgb25Ob2RlQWN0aW9uKHNjb3BlLCB0b2tlbikpO1xyXG4gICAgICAgIH1cclxuICAgIH0pXHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckZ1bmN0aW9uQ2FsbChmYXN0biwgc2NvcGUsIGJpbmRpbmcsIHN0YXRpYyl7XHJcbiAgICByZXR1cm4gZmFzdG4oJ3RlbXBsYXRlcicsIHtcclxuICAgICAgICBkYXRhOiBmYXN0bi5iaW5kaW5nKCdpdGVtJyksXHJcbiAgICAgICAgYXR0YWNoVGVtcGxhdGVzOiBmYWxzZSxcclxuICAgICAgICB0ZW1wbGF0ZTogKG1vZGVsKSA9PiB7XHJcbiAgICAgICAgICAgIHZhciB0b2tlbiA9IG1vZGVsLmdldCgnaXRlbScpO1xyXG5cclxuICAgICAgICAgICAgaWYoIXRva2VuKXtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCdkaXYnLFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOiAnbm9kZSBmdW5jdGlvbkNhbGwnLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdDogdGl0bGVCaW5kaW5nKGZhc3RuLCBzY29wZSwgc3RhdGljKSxcclxuICAgICAgICAgICAgICAgICAgICAvL2NvbnRlbnRlZGl0YWJsZTogZmFzdG4uYmluZGluZygnZWRpdCcpLmF0dGFjaChzY29wZSlcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlKGZhc3RuLCBzY29wZSwgZmFzdG4uYmluZGluZygnaXRlbS50YXJnZXQnKSwgc3RhdGljKSxcclxuICAgICAgICAgICAgICAgIGZhc3RuLmJpbmRpbmcoJ2l0ZW0udGFyZ2V0Lm5hbWUnKSxcclxuICAgICAgICAgICAgICAgIGZhc3RuKCdzcGFuJywgeyBjbGFzczogJ3BhcmVudGhlc2lzIG9wZW4nIH0sICcoJyksXHJcbiAgICAgICAgICAgICAgICByZW5kZXJOb2RlTGlzdChmYXN0biwgc2NvcGUsIHN0YXRpYykuYmluZGluZygnaXRlbScpLFxyXG4gICAgICAgICAgICAgICAgZmFzdG4oJ3NwYW4nLCB7IGNsYXNzOiAncGFyZW50aGVzaXMgY2xvc2UnIH0sJyknKVxyXG4gICAgICAgICAgICApXHJcbiAgICAgICAgICAgIC5vbignaW5wdXQnLCBvbk5vZGVJbnB1dChiaW5kaW5nKSlcclxuICAgICAgICAgICAgLm9uKCdjbGljaycsIG9uTm9kZUFjdGlvbihzY29wZSwgdG9rZW4pKTtcclxuICAgICAgICB9XHJcbiAgICB9KVxyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJPcGVyYXRvcihmYXN0biwgc2NvcGUsIGJpbmRpbmcsIHN0YXRpYyl7XHJcbiAgICByZXR1cm4gZmFzdG4oJ3RlbXBsYXRlcicsIHtcclxuICAgICAgICBkYXRhOiBmYXN0bi5iaW5kaW5nKCdpdGVtJyksXHJcbiAgICAgICAgYXR0YWNoVGVtcGxhdGVzOiBmYWxzZSxcclxuICAgICAgICB0ZW1wbGF0ZTogKG1vZGVsKSA9PiB7XHJcbiAgICAgICAgICAgIHZhciB0b2tlbiA9IG1vZGVsLmdldCgnaXRlbScpO1xyXG5cclxuICAgICAgICAgICAgaWYoIXRva2VuKXtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIGZhc3RuKCdkaXYnLFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOiAnbm9kZSBvcGVyYXRvcicsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiB0aXRsZUJpbmRpbmcoZmFzdG4sIHNjb3BlLCBzdGF0aWMpLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vY29udGVudGVkaXRhYmxlOiBmYXN0bi5iaW5kaW5nKCdlZGl0JykuYXR0YWNoKHNjb3BlKVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHRva2VuLmxlZnQgJiYgcmVuZGVyTm9kZShmYXN0biwgc2NvcGUsIGZhc3RuLmJpbmRpbmcoJ2l0ZW0ubGVmdCcpLCBzdGF0aWMpLFxyXG4gICAgICAgICAgICAgICAgJyAnLFxyXG4gICAgICAgICAgICAgICAgZmFzdG4oJ3NwYW4nLCB7ICdjbGFzcyc6ICdzeW1ib2wnIH0sIG9wZXJhdG9yTWFwW3Rva2VuLm9wZXJhdG9yLm5hbWVdLnNvdXJjZSksXHJcbiAgICAgICAgICAgICAgICAnICcsXHJcbiAgICAgICAgICAgICAgICB0b2tlbi5taWRkbGUgJiYgcmVuZGVyTm9kZShmYXN0biwgc2NvcGUsIGZhc3RuLmJpbmRpbmcoJ2l0ZW0ubWlkZGxlJyksIHN0YXRpYyksXHJcbiAgICAgICAgICAgICAgICB0b2tlbi5taWRkbGUgJiYgJyA6ICcsXHJcbiAgICAgICAgICAgICAgICB0b2tlbi5yaWdodCAmJiByZW5kZXJOb2RlKGZhc3RuLCBzY29wZSwgZmFzdG4uYmluZGluZygnaXRlbS5yaWdodCcpLCBzdGF0aWMpXHJcbiAgICAgICAgICAgIClcclxuICAgICAgICAgICAgLm9uKCdpbnB1dCcsIG9uTm9kZUlucHV0KGJpbmRpbmcpKVxyXG4gICAgICAgICAgICAub24oJ2NsaWNrJywgb25Ob2RlQWN0aW9uKHNjb3BlLCB0b2tlbikpO1xyXG4gICAgICAgIH1cclxuICAgIH0pXHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlck51bWJlcihmYXN0biwgc2NvcGUsIGJpbmRpbmcpe1xyXG4gICAgcmV0dXJuIGZhc3RuKCdkaXYnLFxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgY2xhc3M6ICdsaXRlcmFsIG5vZGUnLFxyXG4gICAgICAgICAgICAvL2NvbnRlbnRlZGl0YWJsZTogZmFzdG4uYmluZGluZygnZWRpdCcpLmF0dGFjaChzY29wZSlcclxuICAgICAgICB9LFxyXG4gICAgICAgIGZhc3RuLmJpbmRpbmcoJ2l0ZW0udmFsdWUnKVxyXG4gICAgKVxyXG4gICAgLm9uKCdpbnB1dCcsIG9uTm9kZUlucHV0KGJpbmRpbmcpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVySWRlbnRpZmllcihmYXN0biwgc2NvcGUsIGJpbmRpbmcsIHN0YXRpYyl7XHJcbiAgICByZXR1cm4gZmFzdG4oJ2RpdicsXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBjbGFzczogJ25vZGUgaWRlbnRpZmllcicsXHJcbiAgICAgICAgICAgIC8vY29udGVudGVkaXRhYmxlOiBmYXN0bi5iaW5kaW5nKCdlZGl0JykuYXR0YWNoKHNjb3BlKSxcclxuICAgICAgICAgICAgcmVzdWx0OiB0aXRsZUJpbmRpbmcoZmFzdG4sIHNjb3BlLCBzdGF0aWMpXHJcbiAgICAgICAgfSxcclxuICAgICAgICBmYXN0bi5iaW5kaW5nKCdpdGVtLm5hbWUnKVxyXG4gICAgKVxyXG4gICAgLm9uKCdpbnB1dCcsIG9uTm9kZUlucHV0KGJpbmRpbmcpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyUGVyaW9kKGZhc3RuLCBzY29wZSwgYmluZGluZywgc3RhdGljKXtcclxuICAgIHJldHVybiBmYXN0bignZGl2JyxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIGNsYXNzOiAnbm9kZSBwZXJpb2QnLFxyXG4gICAgICAgICAgICAvL2NvbnRlbnRlZGl0YWJsZTogZmFzdG4uYmluZGluZygnZWRpdCcpLmF0dGFjaChzY29wZSksXHJcbiAgICAgICAgICAgIHJlc3VsdDogdGl0bGVCaW5kaW5nKGZhc3RuLCBzY29wZSwgc3RhdGljKVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcmVuZGVyTm9kZShmYXN0biwgc2NvcGUsIGZhc3RuLmJpbmRpbmcoJ2l0ZW0ubGVmdCcpLCBzdGF0aWMpLFxyXG4gICAgICAgICcuJyxcclxuICAgICAgICByZW5kZXJOb2RlKGZhc3RuLCBzY29wZSwgZmFzdG4uYmluZGluZygnaXRlbS5yaWdodCcpLCBzdGF0aWMpXHJcbiAgICApXHJcbiAgICAub24oJ2lucHV0Jywgb25Ob2RlSW5wdXQoYmluZGluZykpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJQYXJlbnRlc2lzR3JvdXAoZmFzdG4sIHNjb3BlLCBiaW5kaW5nLCBzdGF0aWMpe1xyXG4gICAgcmV0dXJuIGZhc3RuKCdkaXYnLFxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgY2xhc3M6ICdub2RlIGdyb3VwJyxcclxuICAgICAgICAgICAgLy9jb250ZW50ZWRpdGFibGU6IGZhc3RuLmJpbmRpbmcoJ2VkaXQnKS5hdHRhY2goc2NvcGUpLFxyXG4gICAgICAgICAgICByZXN1bHQ6IHRpdGxlQmluZGluZyhmYXN0biwgc2NvcGUsIHN0YXRpYylcclxuICAgICAgICB9LFxyXG4gICAgICAgIGZhc3RuKCdzcGFuJywgeyBjbGFzczogJ3BhcmVudGhlc2lzIG9wZW4nIH0sICcoJyksXHJcbiAgICAgICAgcmVuZGVyTm9kZUxpc3QoZmFzdG4sIHNjb3BlLCBzdGF0aWMpLmJpbmRpbmcoJ2l0ZW0nKSxcclxuICAgICAgICBmYXN0bignc3BhbicsIHsgY2xhc3M6ICdwYXJlbnRoZXNpcyBjbG9zZScgfSwgJyknKVxyXG4gICAgKVxyXG4gICAgLm9uKCdpbnB1dCcsIG9uTm9kZUlucHV0KGJpbmRpbmcpKTtcclxufVxyXG5cclxudmFyIG5vZGVUeXBlUmVuZGVyZXJzID0ge1xyXG4gICAgZnVuY3Rpb25FeHByZXNzaW9uOiByZW5kZXJGdW5jdGlvbkV4cHJlc3Npb24sXHJcbiAgICBmdW5jdGlvbkNhbGw6IHJlbmRlckZ1bmN0aW9uQ2FsbCxcclxuICAgIG9wZXJhdG9yOiByZW5kZXJPcGVyYXRvcixcclxuICAgIG51bWJlcjogcmVuZGVyTnVtYmVyLFxyXG4gICAgaWRlbnRpZmllcjogcmVuZGVySWRlbnRpZmllcixcclxuICAgIHBhcmVudGhlc2lzR3JvdXA6IHJlbmRlclBhcmVudGVzaXNHcm91cCxcclxuICAgIHBlcmlvZDogcmVuZGVyUGVyaW9kXHJcbn07XHJcblxyXG5mdW5jdGlvbiByZW5kZXJOb2RlKGZhc3RuLCBzY29wZSwgYmluZGluZywgc3RhdGljKXtcclxuICAgIHJldHVybiBmYXN0bigndGVtcGxhdGVyJywge1xyXG4gICAgICAgIGRhdGE6IGJpbmRpbmcsXHJcbiAgICAgICAgdGVtcGxhdGU6IChtb2RlbCkgPT4ge1xyXG4gICAgICAgICAgICB2YXIgdG9rZW4gPSBtb2RlbC5nZXQoJ2l0ZW0nKTtcclxuXHJcbiAgICAgICAgICAgIGlmKCF0b2tlbil7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHJldHVybiBub2RlVHlwZVJlbmRlcmVyc1t0b2tlbi50eXBlXShmYXN0biwgc2NvcGUsIGJpbmRpbmcsIHN0YXRpYylcclxuICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBvbk5vZGVBY3Rpb24oc2NvcGUsIHRva2VuKSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSlcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyTm9kZUxpc3QoZmFzdG4sIHNjb3BlLCBzdGF0aWMpe1xyXG4gICAgcmV0dXJuIGZhc3RuKCdsaXN0OnNwYW4nLCB7XHJcbiAgICAgICAgY2xhc3M6ICdjb250ZW50JyxcclxuICAgICAgICBpdGVtczogZmFzdG4uYmluZGluZygnY29udGVudHwqJyksXHJcbiAgICAgICAgdGVtcGxhdGU6ICgpID0+IHJlbmRlck5vZGUoZmFzdG4sIHNjb3BlLCBmYXN0bi5iaW5kaW5nKCdpdGVtJyksIHN0YXRpYylcclxuICAgIH0pXHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZmFzdG4sIGNvbXBvbmVudCwgdHlwZSwgc2V0dGluZ3MsIGNoaWxkcmVuLCBjcmVhdGVJbnRlcm5hbFNjb3BlKXtcclxuICAgIHNldHRpbmdzLnRhZ05hbWUgPSBjb21wb25lbnQuX3RhZ05hbWUgfHwgJ3ByZSc7XHJcblxyXG4gICAgY29tcG9uZW50LmV4dGVuZCgnX2dlbmVyaWMnLCBzZXR0aW5ncywgY2hpbGRyZW4pO1xyXG5cclxuICAgIHZhciB7IGJpbmRpbmcsIG1vZGVsIH0gPSBjcmVhdGVJbnRlcm5hbFNjb3BlKHtcclxuICAgICAgICByZXN1bHRUcmFuc2Zvcm06IG51bGwsXHJcbiAgICAgICAgbm9kZUFjdGlvbjogbnVsbCxcclxuICAgICAgICBjb250ZW50OiBbXSxcclxuICAgICAgICBzb3VyY2U6ICcnLFxyXG4gICAgICAgIGdsb2JhbHM6IHt9XHJcbiAgICB9LCB7fSk7XHJcblxyXG4gICAgZnVuY3Rpb24gdXBkYXRlVG9rZW5zKCl7XHJcbiAgICAgICAgdmFyIGxleGVkID0gbGV4KG1vZGVsLmdldCgnc291cmNlJykpO1xyXG4gICAgICAgIHZhciBwYXJzZWQgPSBwYXJzZShsZXhlZCk7XHJcblxyXG4gICAgICAgIG1vZGVsLnVwZGF0ZSgnY29udGVudCcsIHBhcnNlZCwgeyBzdHJhdGVneTogJ21vcnBoJyB9KTtcclxuICAgIH1cclxuXHJcbiAgICBtb2RlbC5vbignc291cmNlJywgdXBkYXRlVG9rZW5zKTtcclxuXHJcbiAgICBjb21wb25lbnQuaW5zZXJ0KHJlbmRlck5vZGVMaXN0KGZhc3RuLCBtb2RlbCkuYXR0YWNoKG1vZGVsKSk7XHJcbiAgICBjb21wb25lbnQub24oJ3JlbmRlcicsICgpID0+IHtcclxuICAgICAgICBjb21wb25lbnQuZWxlbWVudC5jbGFzc0xpc3QuYWRkKCdwcmVzaEV4cGxvcmVyJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gY29tcG9uZW50O1xyXG59Il19
