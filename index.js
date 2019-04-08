var fastn = require('fastn')(require('fastn/domComponents')({
    preshExplorer: require('./preshExplorerComponent')
}));

module.exports = function(settings){
    if(!settings || !(settings instanceof Object)){
        settings = {}
    }

    return fastn('preshExplorer', settings)
        .attach()
        .render()
};