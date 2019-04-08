var operatorTokens = require('presh/operators');
var operatorMap = Object.keys(operatorTokens).reduce(function(result, operatorSource){
    var operators = operatorTokens[operatorSource];

    Object.keys(operators).forEach(operatorType => {
        var operator = operators[operatorType];
        result[operator.name] = operator;
        result[operator.name].source = operatorSource
    });

    return result;
}, {});
var lex = require('presh/lex');
var parse = require('presh/parse');
var execute = require('presh/execute');

function executeToken(token, data){
    if(!token){
        return;
    }
    var result = execute([token], data.globals).value;
    if(data.resultTransform){
        result = data.resultTransform(result, token, data.globals);
    }

    return result;
}

function titleBinding(fastn, scope){
    return fastn.binding('item|**', fastn.binding('.|**').attach(scope), executeToken)
}

function onNodeInput(binding){
    return function(event, scope){
        var existingNode = scope.get('item');
        try {
            var newNode = parse(lex(event.target.textContent))[0];
        } catch (error) {
            scope.set('item.error', error);
            return;
        }
        console.log(newNode)
        binding(newNode);
    }
}

function onNodeAction(scope, token){
    return function(event, componentScope) {
        var nodeAction = scope.get('nodeAction');
        if(nodeAction){
            nodeAction(event, this, componentScope, token)
        }
    }
}

function renderOperator(fastn, scope, binding){
    return fastn('templater', {
        data: fastn.binding('item'),
        attachTemplates: false,
        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            return fastn('div',
                {
                    class: 'node operator',
                    result: titleBinding(fastn, scope),
                    //contenteditable: fastn.binding('edit').attach(scope)
                },
                token.left && renderNode(fastn, scope, fastn.binding('item.left')),
                ' ',
                fastn('span', { 'class': 'symbol' }, operatorMap[token.operator.name].source),
                ' ',
                token.right && renderNode(fastn, scope, fastn.binding('item.right'))
            )
            .on('input', onNodeInput(binding))
            .on('click', onNodeAction(scope, token));
        }
    })
}

function renderNumber(fastn, scope, binding){
    return fastn('div',
        {
            class: 'literal node',
            //contenteditable: fastn.binding('edit').attach(scope)
        },
        fastn.binding('item.value')
    )
    .on('input', onNodeInput(binding));
}

function renderIdentifier(fastn, scope, binding){
    return fastn('div',
        {
            class: 'node identifier',
            //contenteditable: fastn.binding('edit').attach(scope),
            result: titleBinding(fastn, scope)
        },
        fastn.binding('item.name')
    )
    .on('input', onNodeInput(binding));
}

function renderParentesisGroup(fastn, scope, binding){
    return fastn('div',
        {
            class: 'node group',
            //contenteditable: fastn.binding('edit').attach(scope),
            result: titleBinding(fastn, scope)
        },
        fastn('span', { class: 'parenthesis open' }, '('),
        renderNodeList(fastn, scope).binding('item'),
        fastn('span', { class: 'parenthesis close' }, ')')
    )
    .on('input', onNodeInput(binding));
}

var nodeTypeRenderers = {
    operator: renderOperator,
    number: renderNumber,
    identifier: renderIdentifier,
    parenthesisGroup: renderParentesisGroup
};

function renderNode(fastn, scope, binding){
    return fastn('templater', {
        data: binding,
        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            return nodeTypeRenderers[token.type](fastn, scope, binding)
                .on('click', onNodeAction(scope, token));
        }
    })
}

function renderNodeList(fastn, scope){
    return fastn('list:span', {
        class: 'content',
        items: fastn.binding('content|*'),
        template: () => renderNode(fastn, scope, fastn.binding('item'))
    })
}

module.exports = function(fastn, component, type, settings, children, createInternalScope){
    settings.tagName = component._tagName || 'pre';

    component.extend('_generic', settings, children);

    var { binding, model } = createInternalScope({
        resultTransform: null,
        nodeAction: null,
        content: [],
        source: '',
        globals: {}
    }, {});

    function updateTokens(){
        var lexed = lex(model.get('source'));
        var parsed = parse(lexed);

        model.update('content', parsed, { strategy: 'morph' });
    }

    model.on('source', updateTokens);

    component.insert(renderNodeList(fastn, model).attach(model));
    component.on('render', () => {
        component.element.classList.add('preshExplorer');
    });

    return component;
}