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

explorer.source('(1 + 2) / foo >= 1')
explorer.globals({
    foo: 4
})

window.addEventListener('load', function(){
    document.body.appendChild(explorer.element)
})

setInterval(function(){
    explorer.globals({
        foo: Math.round(Math.random() * 10)
    })
}, 100);