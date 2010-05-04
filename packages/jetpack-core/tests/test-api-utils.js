/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Jetpack.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Drew Willcoxon <adw@mozilla.com> (Original Author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const apiUtils = require("api-utils");

exports.testPublicConstructor = function (test) {
  function PrivateCtor() {}
  PrivateCtor.prototype = {};

  let PublicCtor = apiUtils.publicConstructor(PrivateCtor);
  test.assertEqual(
    PublicCtor.prototype.__proto__,
    PrivateCtor.prototype,
    "PrivateCtor.prototype should be prototype of PublicCtor.prototype"
  );

  function testObj(useNew) {
    let obj = useNew ? new PublicCtor() : PublicCtor();
    test.assert(obj instanceof PublicCtor,
                "Object should be instance of PublicCtor");
    test.assert(obj instanceof PrivateCtor,
                "Object should be instance of PrivateCtor");
    test.assertEqual(obj.__proto__, PublicCtor.prototype,
                "Object prototype should be PublicCtor's prototype");
    test.assertEqual(obj.constructor, PublicCtor,
                     "Object constructor should be PublicCtor");
  }
  testObj(true);
  testObj(false);
};

exports.testValidateOptionsEmpty = function (test) {
  let val = apiUtils.validateOptions(null, {});
  assertObjsEqual(test, val, {});

  val = apiUtils.validateOptions(null, { foo: {} });
  assertObjsEqual(test, val, {});

  val = apiUtils.validateOptions({}, {});
  assertObjsEqual(test, val, {});

  val = apiUtils.validateOptions({}, { foo: {} });
  assertObjsEqual(test, val, {});
};

exports.testValidateOptionsNonempty = function (test) {
  let val = apiUtils.validateOptions({ foo: 123 }, {});
  assertObjsEqual(test, val, {});

  val = apiUtils.validateOptions({ foo: 123, bar: 456 },
                                 { foo: {}, bar: {}, baz: {} });
  assertObjsEqual(test, val, { foo: 123, bar: 456 });
};

exports.testValidateOptionsMap = function (test) {
  let val = apiUtils.validateOptions({ foo: 3, bar: 2 }, {
    foo: { map: function (v) v * v },
    bar: { map: function (v) undefined }
  });
  assertObjsEqual(test, val, { foo: 9, bar: undefined });
};

exports.testValidateOptionsMapException = function (test) {
  let val = apiUtils.validateOptions({ foo: 3 }, {
    foo: { map: function () { throw new Error(); }}
  });
  assertObjsEqual(test, val, { foo: 3 });
};

exports.testValidateOptionsOk = function (test) {
  let val = apiUtils.validateOptions({ foo: 3, bar: 2, baz: 1 }, {
    foo: { ok: function (v) v },
    bar: { ok: function (v) v }
  });
  assertObjsEqual(test, val, { foo: 3, bar: 2 });

  test.assertRaises(
    function () apiUtils.validateOptions({ foo: 2, bar: 2 }, {
      bar: { ok: function (v) v > 2 }
    }),
    'The option "bar" is invalid.',
    "ok should raise exception on invalid option"
  );

  test.assertRaises(
    function () apiUtils.validateOptions(null, { foo: { ok: function (v) v }}),
    'The option "foo" is invalid.',
    "ok should raise exception on invalid option"
  );
};

exports.testValidateOptionsMapOk = function (test) {
  let val = apiUtils.validateOptions({ foo: 3 }, {
    foo: { map: function (v) v * v, ok: function (v) v === 9 }
  });
  assertObjsEqual(test, val, { foo: 9 });
};

exports.testValidateOptionsErrorMsg = function (test) {
  test.assertRaises(
    function () apiUtils.validateOptions(null, {
      foo: { ok: function (v) v, msg: "foo!" }
    }),
    "foo!",
    "ok should raise exception with customized message"
  );
};

function assertObjsEqual(test, obj1, obj2) {
  for (let [key, val] in Iterator(obj1)) {
    test.assert(key in obj2, "obj1 key should be present in obj2");
    test.assertEqual(obj2[key], val, "obj1 value should match obj2 value");
  }
  for (let [key, val] in Iterator(obj2)) {
    test.assert(key in obj1, "obj2 key should be present in obj1");
    test.assertEqual(obj1[key], val, "obj2 value should match obj1 value");
  }
}