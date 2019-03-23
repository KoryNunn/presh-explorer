var explorer = require('../')()

explorer.source('(1 + 2) / foo')
explorer.globals({
    foo: 4
})

window.addEventListener('load', function(){
    document.body.appendChild(explorer.element)
})