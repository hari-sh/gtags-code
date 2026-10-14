const GtagsProvider = require('./gtagsProvider');
const ExternalProvider = require('./externalProvider');

class TagsProviderFactory {
    static create(config, channel) {
        const engine = config.engine || 'gtags';

        switch (engine) {
            case 'external':
                return new ExternalProvider({
                    command: config.externalCommand,
                    args: config.externalArgs,
                    env: config.externalEnv,
                    channel: channel,
                    tools: config.externalTools,
                });

            case 'gtags':
                return new GtagsProvider(
                    config.gtagsCmd || 'gtags',
                    config.globalCmd || 'global'
                );

            default:
                throw new Error(`Unknown tags engine: ${engine}`);
        }
    }
}

module.exports = TagsProviderFactory;
