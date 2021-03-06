# The Javascript API

Often a user will want to display a link to Doenet with a progress
bar.

## new doenet.Worksheet({}) 

By default, the worksheet id is `window.location`.

Options include `api` to set a different API root (for development),
`title` to set the title of the worksheet, and `id` to set the
worksheet URL.  (The provided worksheet URL must have the same origin
as the page.)

A worksheet is also an `xAPI.Object` where it plays the role of an
Activity.

## worksheet.setProgress(p)

Perform a cross-origin PUT
/learners/:user/worksheets/:worksheet/progress via an iframe to set
the progress for the given worksheet to `p`.  This is the asme as
`worksheet.progress = p;`.

## worksheet.addEventListener('progress', function(event, progress) {});

A callback for progress changes.

## new doenet.xAPI.Actor( data )

Represents various xAPI nouns.  `new doenet.xAPI.Actor()` on its own
represents the learner `me`, which you can also access via `doenet.xAPI.actor.me`.

## new doenet.xAPI.Verb( data )

For example, to produce the `reviewed` verb, 
```
new doenet.xAPI.Verb({
  "id": "http://id.tincanapi.com/verb/reviewed",
  "display": {
    "en-US": "reviewed"
  }
});
```
A large number of verbs are available under `doenet.xAPI.verb`.  For
example, instead of creating the `reviewed` verb as above, use
`doenet.xAPI.verb.reviewed`.

## new doenet.xAPI.Object( data )

Generally one does not create an object directly, since there are various types.

For example, a `doenet.Worksheet` is also an `xAPI.Object`,
specifically an `Object` of type Activity.

## new doenet.xAPI.Result( data )

From a a Doenet worksheet, produce an xAPI activity object.

## new doenet.xAPI.Statement( actor, verb, object, ... )

Build an xAPI statement by combining an actor, a verb, and so on.  For example,
```
new doenet.xAPI.Statement(
  doenet.xAPI.actor.me, 
  doenet.xAPI.verb.checkedIn,
  worksheet
  );
```

## worksheet.recordStatement( stmt ) 

performs a cross-origin POST /learners/:user/worksheets/:worksheet/statements

## worksheet.state

This is a proxied object.  To mutate some part of the state,
```
worksheet.state.favoriteNumber = 17;
```
or you can mutate all the state, e.g.,
```
worksheet.state = { x: 17, y: 100 };
```
In either case, such mutations result in a (debounced) patch being sent to the server.

Nested objects are also tracked, e.g., if
```
worksheet.state = { is: { so: { deeply: 'nested' } } };
```
you could run 
```
worksheet.state.is.so.deeply = 'awesome';
```
and trigger a patch.

## worksheet.addEventListener('state', function(event, state) {});

A callback for state changes.

(This is "real-time" via the PATCH mechanism.)

## worksheet.addEventListener('ready', function(err) {...});

A callback for when the worksheet is ready, e.g., the GDPR consent
process has completed.

## worksheet.globalState

This is the same as `worksheet.state` but shared among all viewers of
the page.  There is likewise 
`worksheet.addEventListener('globalState', ...);`

## worksheet.userId

This is a locally-generated fingerprint, which is useful when working with  `globalState`.

## Example

```
let worksheet = new doenet.Worksheet();
worksheet.setProgress( 0.75 );
```
