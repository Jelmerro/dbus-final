// Test the server properties interface works correctly.

const dbus = require('../../');
const Variant = dbus.Variant;
const DBusError = dbus.DBusError;

const {
  Interface, property,
  ACCESS_READ, ACCESS_WRITE
} = dbus.interface;

const TEST_NAME = 'org.test.properties';
const TEST_PATH = '/org/test/path';
const TEST_IFACE = 'org.test.iface';
const USER_ERROR_IFACE = 'org.test.usererror';

const bus = dbus.sessionBus();
bus.on('error', (err) => {
  console.log(`got unexpected connection error:\n${err.stack}`);
});

class UserErrorInterface extends Interface {
  @property({ signature: 's' })
  get UserErrorProperty () {
    throw new DBusError(`${TEST_IFACE}.UserError`, 'user error');
  }

  set UserErrorProperty (_what) {
    throw new DBusError(`${TEST_IFACE}.UserError`, 'user error');
  }
}

class TestInterface extends Interface {
  @property({ signature: 's' })
  SimpleProperty = 'foo';

  @property({ signature: 'v' })
  VariantProperty = new Variant('s', 'foo');

  @property({ signature: '(a{sv}sv)' })
  ComplicatedProperty = [
    {
      foo: new Variant('s', 'bar'),
      bar: new Variant('as', ['fiz', 'buz'])
    },
    'bat',
    new Variant('d', 53)
  ];

  _NotifyingProperty = 'foo';

  @property({ signature: 's' })
  get NotifyingProperty () {
    return this._NotifyingProperty;
  }

  set NotifyingProperty (value) {
    this._NotifyingProperty = value;
    Interface.emitPropertiesChanged(this, {
      NotifyingProperty: value
    }, ['invalid']);
  }

  @property({ signature: 's', access: ACCESS_READ })
  ReadOnly = 'only read';

  @property({ signature: 's', access: ACCESS_WRITE })
  WriteOnly = 'only write';
}

const testIface = new TestInterface(TEST_IFACE);
const userErrorIface = new UserErrorInterface(USER_ERROR_IFACE);

beforeAll(async () => {
  await bus.requestName(TEST_NAME);
  bus.export(TEST_PATH, testIface);
  bus.export(TEST_PATH, userErrorIface);
});

afterAll(() => {
  bus.disconnect();
});

test('the peer interface', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const peer = object.getInterface('org.freedesktop.DBus.Peer');
  expect(peer).toBeDefined();
  expect(peer.Ping).toBeDefined();
  let req = peer.Ping();
  await expect(req).resolves.toBeNull();
  req = peer.GetMachineId();
  await expect(req).resolves.toBeDefined();
});

test('simple property get and set', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);

  const test = object.getInterface(TEST_IFACE);
  expect(test).toBeDefined();
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  expect(properties).toBeDefined();

  // get and set a simple property
  let prop = await properties.Get(TEST_IFACE, 'SimpleProperty');
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.signature).toEqual('s');
  expect(prop.value).toEqual('foo');
  expect(prop.value).toEqual(testIface.SimpleProperty);

  await properties.Set(TEST_IFACE, 'SimpleProperty', new Variant('s', 'bar'));

  prop = await properties.Get(TEST_IFACE, 'SimpleProperty');
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual('bar');
  expect(prop.value).toEqual(testIface.SimpleProperty);

  // get and set a variant property
  prop = await properties.Get(TEST_IFACE, 'VariantProperty');
  expect(prop.value).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(testIface.VariantProperty);

  await properties.Set(TEST_IFACE, 'VariantProperty', new Variant('v', new Variant('d', 53)));
  prop = await properties.Get(TEST_IFACE, 'VariantProperty');
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(new Variant('d', 53));
  expect(prop.value).toEqual(testIface.VariantProperty);

  // test get all properties
  const all = await properties.GetAll(TEST_IFACE);
  expect(all).toHaveProperty('SimpleProperty', new Variant('s', testIface.SimpleProperty));
  expect(all).toHaveProperty('VariantProperty', new Variant('v', testIface.VariantProperty));
});

test('complicated property get and set', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  let prop = await properties.Get(TEST_IFACE, 'ComplicatedProperty');
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(testIface.ComplicatedProperty);

  const updatedProp = [
    {
      oof: new Variant('s', 'rab'),
      rab: new Variant('as', ['zif', 'zub', 'zork']),
      kevin: new Variant('a{sv}', {
        foo: new Variant('s', 'bar')
      })
    },
    'tab',
    new Variant('d', 23)
  ];

  await properties.Set(TEST_IFACE, 'ComplicatedProperty', new Variant('(a{sv}sv)', updatedProp));
  prop = await properties.Get(TEST_IFACE, 'ComplicatedProperty');
  expect(prop).toBeInstanceOf(Variant);
  expect(prop.value).toEqual(testIface.ComplicatedProperty);
  expect(prop.value).toEqual(updatedProp);
});

test('properties changed signal', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  const onPropertiesChanged = jest.fn(() => null);
  properties.on('PropertiesChanged', onPropertiesChanged);

  await properties.Set(TEST_IFACE, 'NotifyingProperty', new Variant('s', 'bar'));
  const e = {
    NotifyingProperty: new Variant('s', 'bar')
  };
  expect(onPropertiesChanged).toHaveBeenCalledWith(TEST_IFACE, e, ['invalid']);
});

test('read and write access', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');

  let req = properties.Get(TEST_IFACE, 'WriteOnly');
  await expect(req).rejects.toBeInstanceOf(DBusError);

  req = properties.Set(TEST_IFACE, 'ReadOnly', new Variant('s', 'foo'));
  await expect(req).rejects.toBeInstanceOf(DBusError);
});

test('properties interface specific errors', async () => {
  const object = await bus.getProxyObject(TEST_NAME, TEST_PATH);
  const properties = object.getInterface('org.freedesktop.DBus.Properties');

  let req = properties.Set('not.an.interface', 'ReadOnly', new Variant('s', 'foo'));
  await expect(req).rejects.toBeInstanceOf(DBusError);

  req = properties.Get(TEST_IFACE, 'NotAProperty');
  await expect(req).rejects.toBeInstanceOf(DBusError);

  req = properties.Set(TEST_IFACE, 'NotAProperty', new Variant('s', 'foo'));
  await expect(req).rejects.toBeInstanceOf(DBusError);

  req = properties.Set(TEST_IFACE, 'WriteOnly', new Variant('as', ['wrong', 'type']));
  await expect(req).rejects.toBeInstanceOf(DBusError);

  // user errors
  req = properties.Get(USER_ERROR_IFACE, 'UserErrorProperty');
  await expect(req).rejects.toBeInstanceOf(DBusError);

  req = properties.Set(USER_ERROR_IFACE, 'UserErrorProperty', new Variant('s', 'foo'));
  await expect(req).rejects.toBeInstanceOf(DBusError);

  req = properties.GetAll(USER_ERROR_IFACE);
  await expect(req).rejects.toBeInstanceOf(DBusError);
});
