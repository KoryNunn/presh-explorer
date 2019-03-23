var fastn = require('fastn')(require('fastn/domComponents')());
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

function executeToken(token, scope){
    return execute([token], scope.globals).value;
}

function titleBinding(scope){
    return fastn.binding('item|**', fastn.binding('.').attach(scope), executeToken)
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

function renderOperator(scope, binding){
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
                    result: titleBinding(scope),
                    //contenteditable: fastn.binding('edit').attach(scope)
                },
                token.left && renderNode(scope, fastn.binding('item.left')),
                operatorMap[token.operator.name].source,
                token.right && renderNode(scope, fastn.binding('item.right'))
            ).on('input', onNodeInput(binding));
        }
    })
}

function renderNumber(scope, binding){
    return fastn('div',
        {
            class: 'token',
            //contenteditable: fastn.binding('edit').attach(scope)
        },
        fastn.binding('item.value')
    )
    .on('input', onNodeInput(binding));
}

function renderIdentifier(scope, binding){
    return fastn('div',
        {
            class: 'token identifier',
            //contenteditable: fastn.binding('edit').attach(scope),
            result: titleBinding(scope)
        },
        fastn.binding('item.name')
    )
    .on('input', onNodeInput(binding));
}

function renderParentesisGroup(scope, binding){
    return fastn('div',
        {
            class: 'node parenthesis',
            //contenteditable: fastn.binding('edit').attach(scope),
            result: titleBinding(scope)
        },
        '(',
        renderNodeList(scope).binding('item'),
        ')'
    )
    .on('input', onNodeInput(binding));
}

var nodeTypeRenderers = {
    operator: renderOperator,
    number: renderNumber,
    identifier: renderIdentifier,
    parenthesisGroup: renderParentesisGroup
};

function renderNode(scope, binding){
    return fastn('templater', {
        data: binding,
        template: (model) => {
            var token = model.get('item');

            if(!token){
                return;
            }

            console.log(token)

            return nodeTypeRenderers[token.type](scope, binding);
        }
    })
}

function renderNodeList(scope){
    return fastn('list:span', {
        class: 'content',
        items: fastn.binding('content|*'),
        template: () => renderNode(scope, fastn.binding('item'))
    })
}

module.exports = function(){
    var data = {};

    var model = new fastn.Model(data);

    function updateTokens(){
        var lexed = lex(data.source);
        var parsed = parse(lexed);

        fastn.Model.set(data, 'content', parsed);
    }

    model.on('source', updateTokens);
    model.on('globals', updateTokens);

    var ui = fastn('pre', {
            class: 'preshExplorer',
            source: fastn.binding('source'),
            globals: fastn.binding('globals')
        },
        renderNodeList(data)
    )
    .attach(data)
    .render();

    return ui;
}