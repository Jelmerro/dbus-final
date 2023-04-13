# dbus-final

The (hopefully) final DBus library you will install for Node.js

Because there are far too many unmaintained ones at the moment.

`npm install git+https://github.com/Jelmerro/dbus-final.git`

## About

dbus-final is a fully featured high level library for DBus geared primarily towards integration of applications into Linux desktop and mobile environments.
dbus-final is a fork of [dbus-next](https://github.com/dbusjs/node-dbus-next) which itself is a fork of [dbus-native](https://github.com/sidorares/dbus-native) library.
Since none of the dbus libraries seem actively maintained I decided to do it myself.

## The Client Interface

You can get a proxy object for a name on the bus with the `bus.getProxyObject()` function, passing the name and the path.
The proxy object contains introspection data about the object including a list of nodes and interfaces.
You can get an interface with the `object.getInterface()` function passing the name of the interface.
The interface object has methods you can call that correspond to the methods in the introspection data.
Pass normal JavaScript objects to the parameters of the function and they will automatically be converted into the advertised DBus type.
However, you must use the `Variant` class to represent DBus variants.
Methods will similarly return JavaScript objects converted from the advertised DBus type, with the `Variant` class used to represent returned variants.
If the method returns multiple values, they will be returned within an array.
The interface object is an event emitter that will emit the name of a signal when it is emitted on the bus.
Arguments to the callback should correspond to the arguments of the signal.
This is a brief example of using a proxy object with the [MPRIS](https://specifications.freedesktop.org/mpris-spec/latest/Player_Interface.html) media player interface.

```js
let dbus = require('dbus-final');
let bus = dbus.sessionBus();
let Variant = dbus.Variant;

// getting an object introspects it on the bus and creates the interfaces
let obj = await bus.getProxyObject('org.mpris.MediaPlayer2.vlc', '/org/mpris/MediaPlayer2');

// the interfaces are the primary way of interacting with objects on the bus
let player = obj.getInterface('org.mpris.MediaPlayer2.Player');
let properties = obj.getInterface('org.freedesktop.DBus.Properties');

// call methods on the interface
await player.Play()

// get properties with the properties interface (this returns a variant)
let volumeVariant = await properties.Get('org.mpris.MediaPlayer2.Player', 'Volume');
console.log('current volume: ' + volumeVariant.value);

// set properties with the properties interface using a variant
await properties.Set('org.mpris.MediaPlayer2.Player', 'Volume', new Variant('d', volumeVariant.value + 0.05));

// listen to signals
properties.on('PropertiesChanged', (iface, changed, invalidated) => {
  for (let prop of Object.keys(changed)) {
    console.log(`property changed: ${prop}`);
  }
});
```

For a complete example, see the [MPRIS client](https://github.com/dbusjs/node-dbus-final/blob/master/examples/mpris.js) example which can be used to control media players on the command line.

## The Service Interface

Interfaces extend the `Interface` class. Declare service methods, properties, and signals with the decorators provided from the library. You can optionally request a name on the bus with `bus.requestName()` so clients have a well-known name to connect to. Then call `bus.export()` with the path and interface to expose this interface on the bus.
Methods are called when a DBus client calls that method on the server. Properties can be gotten and set with the `org.freedesktop.DBus.Properties` interface and are included in the introspection xml.
To emit a signal, just call the method marked with the `signal` decorator and the signal will be emitted with the returned value.
If you have an interface xml description, which can be gotten from the `org.freedesktop.DBus.Introspect` method on an exported interface, you can generate dbus-final JavaScript classes from the xml file with the `bin/generate-interfaces.js` utility.

There are two main ways to use the interface, one of which uses decorators, the other an update function.

### Decorators using Babel

This interfaces uses the proposed [decorators syntax](https://github.com/tc39/proposal-decorators) which is not yet part of the ECMAScript standard, but should be included one day. Unfortunately, you'll need a [Babel plugin](https://www.npmjs.com/package/@babel/plugin-proposal-decorators) to make this code work for now.

```js
let dbus = require('dbus-final');
let Variant = dbus.Variant;

let {
  Interface, property, method, signal, DBusError,
  ACCESS_READ, ACCESS_WRITE, ACCESS_READWRITE
} = dbus.interface;

let bus = dbus.sessionBus();

class ExampleInterface extends Interface {
  @property({signature: 's', access: ACCESS_READWRITE})
  SimpleProperty = 'foo';

  _MapProperty = {
    'foo': new Variant('s', 'bar'),
    'bat': new Variant('i', 53)
  };

  @property({signature: 'a{sv}'})
  get MapProperty() {
    return this._MapProperty;
  }

  set MapProperty(value) {
    this._MapProperty = value;

    Interface.emitPropertiesChanged(this, {
      MapProperty: value
    });
  }

  @method({inSignature: 's', outSignature: 's'})
  Echo(what) {
    return what;
  }

  @method({inSignature: 'ss', outSignature: 'vv'})
  ReturnsMultiple(what, what2) {
    return [
      new Variant('s', what),
      new Variant('s', what2)
    ];
  }

  @method({inSignature: '', outSignature: ''})
  ThrowsError() {
    // the error is returned to the client
    throw new DBusError('org.test.iface.Error', 'something went wrong');
  }

  @method({inSignature: '', outSignature: '', noReply: true})
  NoReply() {
    // by setting noReply to true, dbus-final will NOT send a return reply through dbus
    // after the method is called.
  }

  @signal({signature: 's'})
  HelloWorld(value) {
    return value;
  }

  @signal({signature: 'ss'})
  SignalMultiple(x) {
    return [
      'hello',
      'world'
    ];
  }
}

let example = new ExampleInterface('org.test.iface');

setTimeout(() => {
  // emit the HelloWorld signal by calling the method with the parameters to
  // send to the listeners
  example.HelloWorld('hello');
}, 500);

async function main() {
  // make a request for the name on the bus
  await bus.requestName('org.test.name');
  // export the interface on the path
  bus.export('/org/test/path', example);
}

main().catch((err) => {
  console.log('Error: ' + err);
});
```

### Update function to configure members without babel

This is the same code snippet, but instead of using decorators it uses the `configureMembers` function to fix the DBus types.

```js
let dbus = require('dbus-final');
let Variant = dbus.Variant;

let {
  Interface, property, method, signal, DBusError,
  ACCESS_READ, ACCESS_WRITE, ACCESS_READWRITE
} = dbus.interface;

let bus = dbus.sessionBus();

class ExampleInterface extends Interface {
  SimpleProperty = 'foo';

  _MapProperty = {
    'foo': new Variant('s', 'bar'),
    'bat': new Variant('i', 53)
  };

  get MapProperty() {
    return this._MapProperty;
  }

  set MapProperty(value) {
    this._MapProperty = value;

    Interface.emitPropertiesChanged(this, {
      MapProperty: value
    });
  }

  Echo(what) {
    return what;
  }

  ReturnsMultiple(what, what2) {
    return [
      new Variant('s', what),
      new Variant('s', what2)
    ];
  }

  ThrowsError() {
    // the error is returned to the client
    throw new DBusError('org.test.iface.Error', 'something went wrong');
  }

  NoReply() {
    // by setting noReply to true, dbus-final will NOT send a return reply through dbus
    // after the method is called.
  }

  HelloWorld(value) {
    return value;
  }

  SignalMultiple(x) {
    return [
      'hello',
      'world'
    ];
  }
}
ExampleInterface.configureMembers({
    methods: {
        Echo: {inSignature: 's', outSignature: 's'},
        ReturnsMultiple: {inSignature: 'ss', outSignature: 'vv'},
        ThrowsError: {inSignature: '', outSignature: ''},
        NoReply: {inSignature: '', outSignature: '', noReply: true}
    },
    properties: {
        SimpleProperty: {signature: 's', access: ACCESS_READWRITE},
        MapProperty: {signature: 'a{sv}'}
    },
    signals: {
        HelloWorld: {signature: 's'},
        SignalMultiple: {signature: 'ss'}
    }
})

let example = new ExampleInterface('org.test.iface');

setTimeout(() => {
  // emit the HelloWorld signal by calling the method with the parameters to
  // send to the listeners
  example.HelloWorld('hello');
}, 500);

async function main() {
  // make a request for the name on the bus
  await bus.requestName('org.test.name');
  // export the interface on the path
  bus.export('/org/test/path', example);
}

main().catch((err) => {
  console.log('Error: ' + err);
});
```

This method is recommended if you are not using babel or do not want to use decorators.

## The Low-Level Interface

The low-level interface can be used to interact with messages directly. Create new messages with the `Message` class to be sent on the bus as method calls, signals, method returns, or errors. Method calls can be called with the `call()` method of the `MessageBus` to await a reply and `send()` can be use for messages that don't expect a reply.

```js
let dbus = require('dbus-final');
let Message = dbus.Message;

let bus = dbus.sessionBus();

// send a method call to list the names on the bus
let methodCall = new Message({
  destination: 'org.freedesktop.DBus',
  path: '/org/freedesktop/DBus',
  interface: 'org.freedesktop.DBus',
  member: 'ListNames'
});

let reply = await bus.call(methodCall);
console.log('names on the bus: ', reply.body[0]);

// add a custom handler for a particular method
bus.addMethodHandler((msg) => {
  if (msg.path === '/org/test/path' &&
      msg.interface === 'org.test.interface'
      && msg.member === 'SomeMethod') {
    // handle the method by sending a reply
    let someMethodReply = Message.newMethodReturn(msg, 's', ['hello']);
    bus.send(someMethodReply);
    return true;
  }
});

// listen to any messages that are sent to the bus
bus.on('message', (msg) => {
  console.log('got a message: ', msg);
});
```

For a complete example of how to use the low-level interface to send messages, see the `dbus-final-send.js` script in the `bin` directory.

## The Type System

Values that are sent or received over the message bus always have an associated signature that specifies the types of those values. For the high-level client and service, these signatures are specified in XML data which is advertised in a [standard DBus interface](https://dbus.freedesktop.org/doc/dbus-specification.html#introspection-format). The high-level client dynamically creates classes based on this introspection data with methods and signals with arguments based on the type signature. The high-level service does the inverse by introspecting the class to create the introspection XML data which is advertised on the bus for clients.

Each code in the signature is mapped to a JavaScript type as shown in the table below.

| Name        | Code | JS Type | Notes                                                              |
|-------------|------|---------|--------------------------------------------------------------------|
| BYTE        | y    | number  |                                                                    |
| BOOLEAN     | b    | boolean |                                                                    |
| INT16       | n    | number  |                                                                    |
| UINT16      | q    | number  |                                                                    |
| INT32       | i    | number  |                                                                    |
| UINT32      | u    | number  |                                                                    |
| INT64       | x    | BigInt  |                                                                    |
| UINT64      | t    | BigInt  |                                                                    |
| DOUBLE      | d    | number  |                                                                    |
| STRING      | s    | string  |                                                                    |
| OBJECT_PATH | o    | string  | Must be a valid object path                                        |
| SIGNATURE   | g    | string  | Must be a valid signature                                          |
| UNIX_FD     | h    | number  | Must be a valid unix file descriptor. e.g. from `fs.open()`        |
| ARRAY       | a    | Array   | Must be followed by a complete type which specifies the child type |
| STRUCT      | (    | Array   | Types in the JS Array must match the types between the parens      |
| VARIANT     | v    | Variant | This class is provided by the library.                             |
| DICT_ENTRY  | {    | Object  | Must be included in an array type to be an object.                 |

Unix file descriptors are only supported on abstract or domain (path) sockets. This is the default for both system and session bus.
When sending a file descriptor it must be kept open until the message is delivered.
When receiving a file descriptor the application is responsible for closing it.

The types `a`, `(`, `v`, and `{` are container types that hold other values. Examples of container types and JavaScript examples are in the table below.

| Signature | Example                                | Notes                                                                                                                                     |
|-----------|----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `(su)`    | `[ 'foo', 5 ]`                         | Each element in the array must match the corresponding type of the struct member.                                                         |
| `as`      | `[ 'foo', 'bar' ]`                     | The child type comes immediately after the `a`. The array can have any number of elements, but they all must match the child type.        |
| `a{su}`   | `{ 'foo': 5 }`                         | An "array of dict entries" is represented by an Object. The type after `{` is the key type and the type before the `}` is the value type. |
| `ay`      | `Buffer.from([0x62, 0x75, 0x66])`      | Special case: an array of bytes is represented by a Node `Buffer`.                                                                        |
| `v`       | `new Variant('s', 'hello')`            | Signature must be a single type. Value may be a container type.                                                                           |
| `(asv)`   | `[ ['foo'], new Variant('s', 'bar') ]` | Containers may be nested.                                                                                                                 |

For more information on the DBus type system, see [the specification](https://dbus.freedesktop.org/doc/dbus-specification.html#type-system).

### Negotiating Unix File Descriptors

To support negotiating Unix file descriptors (DBus type `h`), set `negotiateUnixFd` to `true` in the message bus constructor options. The value of any type `h` in messages sent or received should be the file descriptor itself. You are responsible for closing any file descriptor sent or received by the bus.
