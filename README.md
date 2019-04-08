# Presh explorer

Very alpha, only supports operators, numbers, identifiers, and parenthesis

# Usage

```js
var explorer = require('presh-explorer')()

explorer.source('1 + 2 / foo')
explorer.globals({
    foo: 4
})

window.addEventListener('load', function(){
    document.body.appendChild(explorer.element)
})
```