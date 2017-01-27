# NGNX.DATA.FileProxy

`npm i ngnx-data-proxy-file`

```js
require('ngnx-data-proxy-file')

const Person = new NGN.DATA.Model({
  fields: {
    firstname: null,
    lastname: null
  },

  proxy: new NGNX.DATA.FileProxy('./mydb.txt')
})
```

The file proxy is used to perform CRUD operations from an NGN.DATA.Store and/or
NGN.DATA.Model against a file. While this proxy will work on it's own, it is of
generic design. The primary purpose of this class is to be extended by specific
file proxies, such as NGNX.DATA.JsonFileProxy or NGNX.DATA.XmlFileProxy.

Extended file proxies can provide support for parsing JSON, XML, ini, or any
other type of data structure. This class does not provide that type of support.  
