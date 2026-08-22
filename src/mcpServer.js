const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
const { initDB, openDB, getValueFromDb, searchQuery } = require('./database');
const { getPattern, queryReferences, querySymbolReferences } = require('./query');

async function startMcpServer(workspaceRoot) {
  const server = new Server(
    {
      name: 'gtags-mcp-server',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  initDB(workspaceRoot);
  try {
    await openDB();
  } catch (err) {
    console.error('Failed to open tagsdb:', err.message);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'gtags_get_definition',
          description: 'Get the definition (file path and search pattern) of a symbol (function, variable, type, etc.) from the workspace tags database.',
          inputSchema: {
            type: 'object',
            properties: {
              symbol: {
                type: 'string',
                description: 'The exact name of the symbol to query.'
              }
            },
            required: ['symbol']
          }
        },
        {
          name: 'gtags_search_symbols',
          description: 'Search symbols in the workspace tags database matching a query term or pattern.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Partial name or search term for symbol lookup.'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 20).'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'gtags_get_references',
          description: 'Find all references of a symbol, function, variable, or member expression (supporting `obj->field` or `obj.field`) across the workspace using GNU Global.',
          inputSchema: {
            type: 'object',
            properties: {
              symbol: {
                type: 'string',
                description: 'The symbol or member expression to query references for (e.g. `foo`, `obj->field`, `obj.field`).'
              }
            },
            required: ['symbol']
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'gtags_get_definition') {
      const symbol = args?.symbol;
      if (!symbol) {
        return {
          content: [{ type: 'text', text: 'Error: symbol parameter is required.' }],
          isError: true
        };
      }
      const tagInfo = await getValueFromDb(`tag:${symbol}`);
      if (!tagInfo) {
        return {
          content: [{ type: 'text', text: `No definition found for symbol: ${symbol}` }]
        };
      }
      const fullPath = path.isAbsolute(tagInfo.file) ? tagInfo.file : path.join(workspaceRoot, tagInfo.file);
      
      let line = null;
      let column = null;
      if (tagInfo.pattern) {
        let patternStr = tagInfo.pattern;
        let matchWhole = false;
        if (patternStr.startsWith('^')) patternStr = patternStr.substring(1);
        if (patternStr.endsWith('$')) {
          patternStr = patternStr.substring(0, patternStr.length - 1);
          matchWhole = true;
        }
        try {
          const ldata = await getPattern(fullPath, symbol, null, patternStr, matchWhole);
          if (ldata && ldata.found) {
            line = ldata.lno;
            column = ldata.charPos + 1;
          }
        } catch (_) {}
      }

      const locationStr = line ? `${fullPath}:${line}:${column || 1}` : fullPath;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                symbol,
                location: locationStr,
                file: fullPath,
                line: line,
                column: column
              },
              null,
              2
            )
          }
        ]
      };
    } else if (name === 'gtags_search_symbols') {
      const query = args?.query;
      const limit = typeof args?.limit === 'number' ? args.limit : 20;
      if (!query) {
        return {
          content: [{ type: 'text', text: 'Error: query parameter is required.' }],
          isError: true
        };
      }
      const results = await searchQuery(query, null, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2)
          }
        ]
      };
    } else if (name === 'gtags_get_references' || name === 'gtags_get_symbol_references') {
      const sym = args?.symbol || args?.tag;
      if (!sym) {
        return {
          content: [{ type: 'text', text: 'Error: symbol parameter is required.' }],
          isError: true
        };
      }
      const { matches } = await queryReferences(workspaceRoot, sym);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(matches, null, 2)
          }
        ]
      };
    } else {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true
      };
    }
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
  return server;
}

if (require.main === module) {
  const workspaceRoot = process.argv[2] || process.cwd();
  startMcpServer(workspaceRoot);
}

module.exports = { startMcpServer };
