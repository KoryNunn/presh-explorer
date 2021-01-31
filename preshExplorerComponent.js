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
var Scope = require('presh/scope');
var globals = require('presh/global');

function executeToken(token, data){
    if(!token || data.edit){
        return;
    }

    var executionResult = execute([token], { ...globals, ...data.globals });
    if(executionResult.error){
        return executionResult.error.message;
    }
    var result = executionResult.value;

    if(data.resultTransform){
        result = data.resultTransform(result, token, { ...globals, ...data.globals });
    }

    try {
        return JSON.stringify(result) || String(result);
    } catch (error) {
        return String(result);
    }
}

function titleBinding(fastn, scope, isStatic){
    if(isStatic){
        return;
    }
    return fastn.binding('item|**', fastn.binding('.|**').attach(scope), executeToken)
}

function getAllTextNodes(target) {
  if (!target) {
    return [];
  }

    return Array.from(target.childNodes).reduce((result, node) => {
        var nodeType = node.nodeType;

        if (nodeType == 3) {
            result.push(node);
        }
        if (nodeType == 1 || nodeType == 9 || nodeType == 11) {
            result = result.concat(getAllTextNodes(node));
        }

        return result;
    }, []);
}

function onNodeInput(model, component){
    return function(event, scope){
        var newSource = event.target.closest('.preshExplorer').textContent;
        component.emit('source', newSource);
        if(event.keyCode === 10 && event.ctrlKey) {
            event.preventDefault();
            component.emit('save', newSource);
        }
    }
}

function onNodeAction(scope, token){
    return function(event, componentScope) {
        var { nodeAction, edit } = scope.get('.');
        if(nodeAction && !edit){
            nodeAction(event, this, componentScope, token)
        }
    }
}

function renderFunctionExpression(fastn, scope, binding, isStatic){
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
                    class: 'node functionExpression',
                    result: titleBinding(fastn, scope, isStatic)
                },
                fastn.binding('item.identifier.name'),
                '(',
                fastn('list:span', {
                    items: fastn.binding('item.parameters'),
                    template: () => fastn('span', { class: 'node literal' }, fastn.binding('item.name'))
                }),
                ')',
                '{',
                renderNodeList(fastn, scope, true).binding('item'),
                '}'
            )
            .on('click', onNodeAction(scope, token));
        }
    })
}

function renderFunctionCall(fastn, scope, binding, isStatic){
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
                    class: 'node functionCall',
                    result: titleBinding(fastn, scope, isStatic),
                },
                renderNode(fastn, scope, fastn.binding('item.target'), isStatic),
                fastn('span', { class: 'parenthesis open' }, '('),
                renderNodeList(fastn, scope, isStatic).binding('item'),
                fastn('span', { class: 'parenthesis close' },')')
            )
            .on('click', onNodeAction(scope, token));
        }
    })
}

function renderOperator(fastn, scope, binding, isStatic){
    return fastn('templater', {
        data: fastn.binding('item'),
        attachTemplates: false,
        template: (model) => {
            var token = model.get('item');

            if(!token || token.type !== 'operator'){
                return;
            }

            return fastn('div',
                {
                    class: 'node operator',
                    result: titleBinding(fastn, scope, isStatic),
                },
                token.left && renderNode(fastn, scope, fastn.binding('item.left'), isStatic),
                ' ',
                fastn('span', { 'class': 'symbol' }, operatorMap[token.operator.name].source),
                ' ',
                token.middle && renderNode(fastn, scope, fastn.binding('item.middle'), isStatic),
                token.middle && ' : ',
                token.right && renderNode(fastn, scope, fastn.binding('item.right'), isStatic)
            )
            .on('click', onNodeAction(scope, token));
        }
    })
}

function renderNumber(fastn, scope, binding){
    return fastn('div',
        {
            class: 'literal node',
        },
        fastn.binding('item.value')
    )
    .on('input', onNodeInput(binding));
}

function renderIdentifier(fastn, scope, binding, isStatic){
    return fastn('div',
        {
            class: 'node identifier',
            result: titleBinding(fastn, scope, isStatic)
        },
        fastn.binding('item.name')
    )
    .on('input', onNodeInput(binding));
}

function renderPeriod(fastn, scope, binding, isStatic){
    return fastn('div',
        {
            class: 'node period',
            result: titleBinding(fastn, scope, isStatic)
        },
        renderNode(fastn, scope, fastn.binding('item.left'), isStatic),
        '.',
        renderNode(fastn, scope, fastn.binding('item.right'), isStatic)
    )
    .on('input', onNodeInput(binding));
}

function renderParentesisGroup(fastn, scope, binding, isStatic){
    return fastn('div',
        {
            class: 'node group',
            result: titleBinding(fastn, scope, isStatic)
        },
        fastn('span', { class: 'parenthesis open' }, '('),
        renderNodeList(fastn, scope, isStatic).binding('item'),
        fastn('span', { class: 'parenthesis close' }, ')')
    )
    .on('input', onNodeInput(binding));
}

var nodeTypeRenderers = {
    functionExpression: renderFunctionExpression,
    functionCall: renderFunctionCall,
    operator: renderOperator,
    number: renderNumber,
    identifier: renderIdentifier,
    parenthesisGroup: renderParentesisGroup,
    period: renderPeriod
};

function renderNode(fastn, scope, binding, isStatic){
    return fastn('templater', {
        data: binding,

        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            return nodeTypeRenderers[token.type](fastn, scope, binding, isStatic)
                .on('click', onNodeAction(scope, token));
        }
    })
}

function renderNodeList(fastn, scope, isStatic){
    return fastn('list:span', {
        class: 'content',
        items: fastn.binding('content|*'),
        template: () => renderNode(fastn, scope, fastn.binding('item'), isStatic)
    })
}

module.exports = function(fastn, component, type, settings, children, createInternalScope){
    settings.tagName = component._tagName || 'pre';

    component.extend('_generic', settings, children);

    var { binding, model } = createInternalScope({
        edit: false,
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

    component.insert(
        fastn('div', {
            contenteditable: binding('edit', edit => 
                edit || undefined
            )
        },
        renderNodeList(fastn, model).attach(model)
    ));
    component.on('render', () => {
        component.element.classList.add('preshExplorer');
    })
    .on('keypress', onNodeInput(model, component));

    return component;
}