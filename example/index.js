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
    (
        1 / 12 *
        bar + add(2 4 / foo)
    ) / foo
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