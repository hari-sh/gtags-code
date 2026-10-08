const GtagsProvider = require('./gtagsProvider');
const { ExternalProvider } = require('./externalProvider');

class TagsProviderFactory {
    static create(config, channel) {
        const engine = config.engine || 'gtags';

        switch (engine) {
            case 'external':
                if (!config.externalCommand || config.externalCommand.length === 0) {
                    throw new Error('Configure "gtags-code.externalCommand" before using the external engine.');
                }
                return new ExternalProvider({
                    command: config.externalCommand,
                    args: config.externalArgs,
                    indexCommand: config.externalIndexCommand,
                    indexArgs: config.externalIndexArgs,
                    env: config.externalEnv,
                    timeout: config.externalTimeout,
                    channel: channel
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
