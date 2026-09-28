const GtagsProvider = require('./gtagsProvider');

class TagsProviderFactory {
    static create(config) {
        // Here we can read config.get('engine') in the future to return different providers.
        // For now, we default to GtagsProvider.
        const engine = config.engine || 'gtags';

        if (engine === 'gtags') {
            const gtagsCmd = config.gtagsCmd || 'gtags';
            const globalCmd = config.globalCmd || 'global';
            return new GtagsProvider(gtagsCmd, globalCmd);
        }

        throw new Error(`Unknown tags engine: ${engine}`);
    }
}

module.exports = TagsProviderFactory;
