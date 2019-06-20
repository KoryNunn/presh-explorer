# Presh explorer

Less alpha, supports operators, numbers, identifiers, parenthesis, function calls, turnarys, and partially supports lambdas

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
