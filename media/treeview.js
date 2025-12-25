// your existing treeview.js goes here
(function (exports, d3, api) {
  'use strict';

  function _extends() {
    _extends = Object.assign ? Object.assign.bind() : function (target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
      return target;
    };
    return _extends.apply(this, arguments);
  }

  function noop() {
  }

  function addClass(className, ...rest) {
    const classList = (className || '').split(' ').filter(Boolean);
    rest.forEach(item => {
      if (item && classList.indexOf(item) < 0) classList.push(item);
    });
    return classList.join(' ');
  }

  function childSelector(filter) {
    if (typeof filter === 'string') {
      const tagName = filter;
      filter = el => el.tagName === tagName;
    }
    const filterFn = filter;
    return function selector() {
      let nodes = Array.from(this.childNodes);
      if (filterFn) nodes = nodes.filter(node => filterFn(node));
      return nodes;
    };
  }

  const VTYPE_ELEMENT = 1;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const NS_ATTRS = {
    show: XLINK_NS,
    actuate: XLINK_NS,
    href: XLINK_NS
  };

  const isLeaf = c => typeof c === 'string' || typeof c === 'number';
  const isElement = c => (c == null ? void 0 : c.vtype) === VTYPE_ELEMENT;

  function jsx(type, props) {
    let vtype;
    if (typeof type === 'string')
      vtype = VTYPE_ELEMENT;
    return {
      vtype,
      type,
      props
    };
  }

  const DEFAULT_ENV = {
    isSvg: false
  };

  function insertDom(parent, nodes) {
    if (!Array.isArray(nodes))
      nodes = [nodes];
    nodes = nodes.filter(Boolean);
    if (nodes.length)
      parent.append(...nodes);
  }

  function mountAttributes(domElement, props, env) {
    for (const key in props) {
      if (key === 'key' || key === 'children' || key === 'ref') continue;
      if (key === 'dangerouslySetInnerHTML') {
        domElement.innerHTML = props[key].__html;
      } else if (key === 'innerHTML' || key === 'textContent' || key === 'innerText' || key === 'value' && ['textarea', 'select'].includes(domElement.tagName)) {
        const value = props[key];
        if (value != null) domElement[key] = value;
      } else if (key.startsWith('on')) {
        domElement[key.toLowerCase()] = props[key];
      } else {
        setDOMAttribute(domElement, key, props[key], env.isSvg);
      }
    }
  }
  const attrMap = {
    className: 'class',
    labelFor: 'for'
  };
  function setDOMAttribute(el, attr, value, isSVG) {
    attr = attrMap[attr] || attr;
    if (value === true) {
      el.setAttribute(attr, '');
    } else if (value === false) {
      el.removeAttribute(attr);
    } else {
      const namespace = isSVG ? NS_ATTRS[attr] : undefined;
      if (namespace !== undefined) {
        el.setAttributeNS(namespace, attr, value);
      } else {
        el.setAttribute(attr, value);
      }
    }
  }
  function flatten(arr) {
    return arr.reduce((prev, item) => prev.concat(item), []);
  }
  function mountChildren(children, env) {
    return Array.isArray(children) ? flatten(children.map(child => mountChildren(child, env))) : mount(children, env);
  }
  function mount(vnode, env = DEFAULT_ENV) {
    if (isLeaf(vnode)) {
      return document.createTextNode(`${vnode}`);
    }
    if (isElement(vnode)) {
      let node;
      const {
        type,
        props
      } = vnode;
      if (!env.isSvg && type === 'svg') {
        env = Object.assign({}, env, {
          isSvg: true
        });
      }
      if (!env.isSvg) {
        node = document.createElement(type);
      } else {
        node = document.createElementNS(SVG_NS, type);
      }
      mountAttributes(node, props, env);
      if (props.children) {
        let childEnv = env;
        if (env.isSvg && type === 'foreignObject') {
          childEnv = Object.assign({}, childEnv, {
            isSvg: false
          });
        }
        const children = mountChildren(props.children, childEnv);
        if (children != null) insertDom(node, children);
      }
      const {
        ref
      } = props;
      if (typeof ref === 'function') ref(node);
      return node;
    }
    throw new Error('mount: Invalid Vnode!');
  }

  var css_248z$1 = ".markmap{font:300 16px/20px sans-serif}.markmap-link{fill:none}.markmap-node>circle{cursor:pointer}.markmap-foreign{display:inline-block}.markmap-foreign a{color:#0097e6}.markmap-foreign a:hover{color:#00a8ff}.markmap-foreign code{background-color:#f0f0f0;border-radius:2px;color:#555;font-size:calc(1em - 2px);padding:.25em}.markmap-foreign pre{margin:0}.markmap-foreign pre>code{display:block}.markmap-foreign del{text-decoration:line-through}.markmap-foreign em{font-style:italic}.markmap-foreign strong{font-weight:700}.markmap-foreign mark{background:#ffeaa7}";

  var css_248z = ".markmap-container{height:0;left:-100px;overflow:hidden;position:absolute;top:-100px;width:0}.markmap-container>.markmap-foreign{display:inline-block}.markmap-container>.markmap-foreign>div:last-child,.markmap-container>.markmap-foreign>div:last-child *{white-space:nowrap}";

  const globalCSS = css_248z$1;
  function linkWidth(nodeData) {
    const data = nodeData.data;
    return Math.max(4 - 2 * data.depth, 1.5);
  }

  function stopPropagation(e) {
    e.stopPropagation();
  }

  const defaultColorFn = d3.scaleOrdinal(d3.schemeCategory10);
  const isMacintosh = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');
  class Markmap {
    constructor(svg, opts) {
      this.options = Markmap.defaultOptions;
      this.revokers = [];
      this.handleZoom = e => {
        const {
          transform
        } = e;
        this.g.attr('transform', transform);
      };
      this.handlePan = e => {
        e.preventDefault();
        const transform = d3.zoomTransform(this.svg.node());
        const newTransform = transform.translate(-e.deltaX / transform.k, -e.deltaY / transform.k);
        this.svg.call(this.zoom.transform, newTransform);
      };
      this.handleClick = async (e, d) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        let recursive = this.options.toggleRecursively;
        if (isMacintosh ? e.metaKey : e.ctrlKey) recursive = !recursive;
        await this.toggleNode(d.data, recursive);
      };

      this.handleTextClick = async (e, d) => {
        const postData = { data: d.data.content, line: d.data.state.line, file: d.data.state.file }
        await this.postFileInfo(postData);
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      this.svg = svg.datum ? svg : d3.select(svg);
      this.styleNode = this.svg.append('style');
      this.zoom = d3.zoom().filter(event => {
        if (this.options.scrollForPan) {
          if (event.type === 'wheel') return event.ctrlKey && !event.button;
        }
        return (!event.ctrlKey || event.type === 'wheel') && !event.button;
      }).on('zoom', this.handleZoom);
      this.setOptions(opts);
      this.state = {
        id: this.options.id || this.svg.attr('id'),
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0
      };
      this.g = this.svg.append('g');

    }
    getStyleContent() {
      const {
        style
      } = this.options;
      const {
        id
      } = this.state;
      const styleText = typeof style === 'function' ? style(id) : '';
      return [this.options.embedGlobalCSS && css_248z$1, styleText].filter(Boolean).join('\n');
    }
    updateStyle() {
      this.svg.attr('class', addClass(this.svg.attr('class'), 'markmap', this.state.id));
      const style = this.getStyleContent();
      this.styleNode.text(style);
    }

    async fetchRandom(data) {
      const hashrand = await this.getTagsData(data.content);
      data.children = [];
      hashrand.forEach(element => {
        var data$childObj = {
          content: element.name,
          file: element.file,
          line: element.line,
          children: [
            {
              content: "N",
              isNull: true
            }
          ],
          payload: { "fold": 1 }
        };
        data.children.push(data$childObj);
      });
    }


    async toggleNode(data) {
      var _data$payload2;
      var _data$fold = (_data$payload2 = data.payload) != null && _data$payload2.fold ? 0 : 1;
      if (!_data$fold && !data.hasChild) {
        data.hasChild = true;
        await this.fetchRandom(data);
        this.initializeDataArr(data);
      }
      data.payload = _extends({}, data.payload, {
        fold: _data$fold
      });
      this.renderData(data);
    }
    initdom() {
      const { id } = this.state;
      const container = mount(jsx("div", {
        className: `markmap-container markmap ${id}-g`
      }));
      const style = mount(jsx("style", {
        children: [this.getStyleContent(), css_248z].join('\n')
      }));
      this.container = container;
      document.body.append(container, style);
    }
    getgrp(content) {
      return mount(jsx("div", {
        className: "markmap-foreign",
        style: '',
        children: jsx("div", {
          dangerouslySetInnerHTML: {
            __html: content
          }
        })
      }));
    }

    initializeDataNode(item) {
      const { color, nodeMinHeight } = this.options;
      const group = this.getgrp(item.content);
      this.container.append(group);
      item.state = _extends({}, item.state, {
        id: 1,
        el: group.firstChild
      });
      item.state.path = '1';
      const state = item.state;
      const rect = state.el.getBoundingClientRect();
      item.content = state.el.innerHTML;
      state.size = [Math.ceil(rect.width) + 1, Math.max(Math.ceil(rect.height), nodeMinHeight)];
      state.key = state.id + item.content;
      color(item);
    }

    initializeDataArr(node) {
      const {
        color,
        nodeMinHeight
      } = this.options;
      node.children.forEach((item, ind, arr) => {
        const group = this.getgrp(item.content);
        this.container.append(group);
        item.state = _extends({}, item.state, {
          id: ind + 1,
          el: group.firstChild
        });
        item.state.path = [node.state.path, item.state.id].join('.');
        const state = item.state;
        const rect = state.el.getBoundingClientRect();
        item.content = state.el.innerHTML;
        item.state.file = item.file;
        item.state.line = item.line;
        state.size = [Math.ceil(rect.width) + 1, Math.max(Math.ceil(rect.height), nodeMinHeight)];
        state.key = item.state.path + item.content;
        color(item);
      });
    }

    setOptions(opts) {
      this.options = _extends({}, this.options, opts);
      if (this.options.zoom) {
        this.svg.call(this.zoom);
      } else {
        this.svg.on('.zoom', null);
      }
      if (this.options.pan) {
        this.svg.on('wheel', this.handlePan);
      } else {
        this.svg.on('wheel', null);
      }
    }

    setDataHash(diagStr) {
      this.state.data = {
        content: diagStr,
        children: [
          {
            content: "NULL",
            isNull: true
          }
        ],
        payload: { "fold": 1 }
      };

      this.initdom();
      this.initializeDataNode(this.state.data);
      this.updateStyle();
      this.renderData(this.state.data);
    }

    renderData(originData) {
      var _origin$data$state$x, _origin$data$state$y;
      if (!this.state.data) return;
      const {
        spacingHorizontal,
        paddingX,
        spacingVertical,
        autoFit,
        color
      } = this.options;
      const layout = d3.flextree({}).children(d => {
        var _d$payload;
        if (!((_d$payload = d.payload) != null && _d$payload.fold)) return d.children;
      }).nodeSize(node => {
        const [width, height] = node.data.state.size;
        return [height, width + (width ? paddingX * 2 : 0) + spacingHorizontal];
      }).spacing((a, b) => {
        return a.parent === b.parent ? spacingVertical : spacingVertical * 2;
      });
      const tree = layout.hierarchy(this.state.data);
      layout(tree);
      const descendants = tree.descendants().reverse();
      const links = tree.links();
      const linkShape = d3.linkHorizontal();
      const minX = d3.min(descendants, d => d.x - d.xSize / 2);
      const maxX = d3.max(descendants, d => d.x + d.xSize / 2);
      const minY = d3.min(descendants, d => d.y);
      const maxY = d3.max(descendants, d => d.y + d.ySize - spacingHorizontal);
      Object.assign(this.state, {
        minX,
        maxX,
        minY,
        maxY
      });
      if (autoFit) this.fit();
      const origin = originData && descendants.find(item => item.data === originData) || tree;
      const x0 = (_origin$data$state$x = origin.data.state.x0) != null ? _origin$data$state$x : origin.x;
      const y0 = (_origin$data$state$y = origin.data.state.y0) != null ? _origin$data$state$y : origin.y;

      const node = this.g.selectAll(childSelector('g')).data(descendants, d => d.data.state.key);
      const nodeEnter = node.enter().append('g').attr('data-depth', d => d.data.depth).attr('data-path', d => d.data.state.path).attr('transform', d => `translate(${y0 + origin.ySize - d.ySize},${x0 + origin.xSize / 2 - d.xSize})`);
      const nodeExit = this.transition(node.exit());
      nodeExit.select('line').attr('x1', d => d.ySize - spacingHorizontal).attr('x2', d => d.ySize - spacingHorizontal);
      nodeExit.select('foreignObject').style('opacity', 0);
      nodeExit.attr('transform', d => `translate(${origin.y + origin.ySize - d.ySize},${origin.x + origin.xSize / 2 - d.xSize})`).remove();
      const nodeMerge = node.merge(nodeEnter).attr('class', d => {
        var _d$data$payload;
        return ['markmap-node', ((_d$data$payload = d.data.payload) == null ? void 0 : _d$data$payload.fold) && 'markmap-fold'].filter(Boolean).join(' ');
      });
      this.transition(nodeMerge).attr('transform', d => `translate(${d.y},${d.x - d.xSize / 2})`);

      const line = nodeMerge.selectAll(childSelector('line')).data(d => [d], d => d.data.state.key).join(enter => {
        return enter.append('line').attr('x1', d => d.ySize - spacingHorizontal).attr('x2', d => d.ySize - spacingHorizontal);
      }, update => update, exit => exit.remove());
      this.transition(line).attr('x1', -1).attr('x2', d => d.ySize - spacingHorizontal + 2).attr('y1', d => d.xSize).attr('y2', d => d.xSize).attr('stroke', d => color(d.data)).attr('stroke-width', linkWidth);

      const circle = nodeMerge.selectAll(childSelector('circle')).data(d => {
        var _d$data$children;
        return (_d$data$children = d.data.children) != null && _d$data$children.length ? [d] : [];
      }, d => d.data.state.key).join(enter => {
        return enter.append('circle').attr('stroke-width', '1.5').attr('cx', d => d.ySize - spacingHorizontal).attr('cy', d => d.xSize).attr('r', 0).on('click', (e, d) => this.handleClick(e, d)).on('mousedown', stopPropagation);
      }, update => update, exit => exit.remove());
      this.transition(circle).attr('r', 6).attr('cx', d => d.ySize - spacingHorizontal).attr('cy', d => d.xSize).attr('stroke', d => color(d.data)).attr('fill', d => {
        var _d$data$payload2;
        return (_d$data$payload2 = d.data.payload) != null && _d$data$payload2.fold && d.data.children ? color(d.data) : '#fff';
      });

      const ground = nodeMerge.selectAll(childSelector('ground')).data(d => {
        return (d.data.isNull === true) ? [d] : [];
      }, d => d.data.state.key).join(enter => {
        return enter.append('circle').attr('stroke-width', '3').attr('cx', d => d.ySize - spacingHorizontal).attr('cy', d => d.xSize).attr('r', 0);
      }, update => update, exit => exit.remove());
      this.transition(ground).attr('r', 3).attr('cx', d => d.ySize - spacingHorizontal).attr('cy', d => d.xSize).attr('stroke', d => color(d.data)).attr('fill', d => {
        var _d$data$payload2;
        return (_d$data$payload2 = d.data.payload) != null && _d$data$payload2.fold && d.data.children ? color(d.data) : '#fff';
      });


      const path = this.g.selectAll(childSelector('path')).data(links, d => d.target.data.state.key).join(enter => {
        const source = [y0 + origin.ySize - spacingHorizontal, x0 + origin.xSize / 2];
        return enter.insert('path', 'g').attr('class', 'markmap-link').attr('data-depth', d => d.target.data.depth).attr('data-path', d => d.target.data.state.path).attr('d', linkShape({
          source,
          target: source
        }));
      }, update => update, exit => {
        const source = [origin.y + origin.ySize - spacingHorizontal, origin.x + origin.xSize / 2];
        return this.transition(exit).attr('d', linkShape({
          source,
          target: source
        })).remove();
      });
      this.transition(path).attr('stroke', d => color(d.target.data)).attr('stroke-width', d => linkWidth(d.target)).attr('d', d => {
        const origSource = d.source;
        const origTarget = d.target;
        const source = [origSource.y + origSource.ySize - spacingHorizontal, origSource.x + origSource.xSize / 2];
        const target = [origTarget.y, origTarget.x + origTarget.xSize / 2];
        return linkShape({
          source,
          target
        });
      });

      const foreignObject = nodeMerge.selectAll(childSelector('foreignObject')).data(d => [d], d => d.data.state.key).join(enter => {
        const fo = enter.append('foreignObject').attr('class', 'markmap-foreign').attr('x', paddingX).attr('y', 0).style('opacity', 0.2).on('mousedown', stopPropagation).on('dblclick', (e, d) => this.handleTextClick(e, d));
        fo.append('xhtml:div').select(function select(d) {
          let clone = d.data.state.el.cloneNode(true);
          this.replaceWith(clone);
          return clone;
        }).attr('xmlns', 'http://www.w3.org/1999/xhtml');
        return fo;
      }, update => update, exit => exit.remove()).attr('width', d => !d.data.isNull ? Math.max(0, d.ySize - spacingHorizontal - paddingX * 2) : 1).attr('height', d => d.xSize);
      this.transition(foreignObject).style('opacity', 1);

      descendants.forEach(d => {
        d.data.state.x0 = d.x;
        d.data.state.y0 = d.y;
      });
    }

    transition(sel) {
      const {
        duration
      } = this.options;
      return sel.transition().duration(duration);
    }

    async fit() {
      const svgNode = this.svg.node();
      const {
        width: offsetWidth,
        height: offsetHeight
      } = svgNode.getBoundingClientRect();
      const {
        fitRatio
      } = this.options;
      const {
        minX,
        maxX,
        minY,
        maxY
      } = this.state;
      const naturalWidth = maxY - minY;
      const naturalHeight = maxX - minX;
      const scale = Math.min(offsetWidth / naturalWidth * fitRatio, offsetHeight / naturalHeight * fitRatio, 2);
      // const initialZoom = d3.zoomIdentity.translate((offsetWidth - naturalWidth * scale) / 2 - minY * scale, (offsetHeight - naturalHeight * scale) / 2 - minX * scale).scale(scale);
      const initialZoom = d3.zoomIdentity.translate(50, (offsetHeight - naturalHeight * scale) / 2 - minX * scale).scale(scale);
      return this.transition(this.svg).call(this.zoom.transform, initialZoom).end().catch(noop);
    }

    destroy() {
      this.svg.on('.zoom', null);
      this.svg.html(null);
      this.revokers.forEach(fn => {
        fn();
      });
    }

    static create(svg, diagStr) {
      const mm = new Markmap(svg, null);
      mm.getTagsData = api.getTags;
      mm.postFileInfo = api.postFileData;
      mm.setDataHash(diagStr);
      mm.fit();
      return mm;
    }
  }

  Markmap.defaultOptions = {
    autoFit: false,
    color: node => {
      var _node$state;
      return defaultColorFn(`${((_node$state = node.state) == null ? void 0 : _node$state.path) || ''}`);
    },
    duration: 500,
    embedGlobalCSS: true,
    fitRatio: 0.95,
    maxWidth: 0,
    nodeMinHeight: 16,
    paddingX: 8,
    scrollForPan: isMacintosh,
    spacingHorizontal: 80,
    spacingVertical: 5,
    initialExpandLevel: -1,
    zoom: true,
    pan: true,
    toggleRecursively: false
  };

  exports.Markmap = Markmap;
  exports.defaultColorFn = defaultColorFn;
  exports.globalCSS = globalCSS;

})(this.markmap = {}, d3, api);
