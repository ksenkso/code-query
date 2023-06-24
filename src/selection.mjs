import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';
import traverseAst from '@babel/traverse';
import vueParser from 'vue-eslint-parser';
import { toCamelCase } from './transform.mjs';
import { attrKey, noop, normalizeComponentName } from './utils.mjs';

export const parseModule = source => parser.parse(source, {
  sourceType: 'module'
});

export const parseVueFile = source => vueParser.parse(source, {
  sourceType: 'module',
  ecmaVersion: 'latest',
});

export const traverse = (source, options) => {
  const ast = parseModule(source);

  traverseAst.default(ast, options)
}

export const enterComponentDefinition = (scriptBody, visitor) => {
  traverseAst.default(scriptBody, {
    ExportDefaultDeclaration(path) {
      const { node } = path;

      return visitor(node, path);
    }
  });
}

export const subtraverse = (ast, options) => {
  traverseAst.default(ast, {
    noScope: true,
    ...options,
  });
}

export const walkDom = function * (dom) {
  const treeWalker = dom.window.document.createTreeWalker(dom.window.document.body, 1);
  while (treeWalker.nextNode()) {
    yield treeWalker.currentNode;
    treeWalker.nextNode();
  }
}

const TEMPLATE_OPEN_TAG = '<template>';
const TEMPLATE_CLOSE_TAG = '</template>';

export const getComponentTemplateStart = (vueFileContent) => {
  const scriptIndex =  vueFileContent.indexOf(TEMPLATE_OPEN_TAG);
  if (scriptIndex === -1) return -1;

  return scriptIndex + TEMPLATE_OPEN_TAG.length;
}

/**
 * @typedef {{
 *   path: string,
 *   content: string,
 *   offset: number,
 * }} ComponentPart
 */

/**
 * @param {string} vueFileContent
 * @param {string} filePath
 * @return {ComponentPart|null}
 */
export const getComponentTemplate = (vueFileContent, filePath) => {
  let templateStartIndex = getComponentTemplateStart(vueFileContent)
  if (templateStartIndex === -1) {
    return null;
  }

  return {
    path: filePath,
    content: vueFileContent.substring(templateStartIndex, vueFileContent.lastIndexOf(TEMPLATE_CLOSE_TAG)),
    offset: templateStartIndex,
  };
}

const SCRIPT_OPEN_TAG = '<script>';
const SCRIPT_OPEN_TAG_WITH_SOURCE = '<script ';
const SCRIPT_CLOSE_TAG = '</script>';
const SRC_REGEXP = /src="(.*)"/;

export const getComponentScriptStart = (vueFileContent) => {
  const scriptIndex =  vueFileContent.indexOf(SCRIPT_OPEN_TAG);
  if (scriptIndex === -1) return -1;

  return scriptIndex + SCRIPT_OPEN_TAG.length;
}
/**
 * @param {string} vueFileContent
 * @param {string} filePath
 * @return {ComponentPart|null}
 */
export const getComponentScript = (vueFileContent, filePath) => {
  let scriptStartIndex = getComponentScriptStart(vueFileContent)
  if (scriptStartIndex === -1) {
    scriptStartIndex = vueFileContent.indexOf(SCRIPT_OPEN_TAG_WITH_SOURCE);
    if (scriptStartIndex === -1) {
      return null;
    }

    const scriptRow = vueFileContent.substring(scriptStartIndex, vueFileContent.indexOf('/>', scriptStartIndex));
    const src = scriptRow.match(SRC_REGEXP)[1];
    const scriptFilePath = path.resolve(path.dirname(filePath), src);

    return {
      path: scriptFilePath,
      content: fs.readFileSync(scriptFilePath, 'utf8'),
      offset: 0,
    };
  }

  return {
    path: filePath,
    content: vueFileContent.substring(scriptStartIndex, vueFileContent.lastIndexOf(SCRIPT_CLOSE_TAG)),
    offset: scriptStartIndex,
  };
}

export const resolveComponentStruct = ({ name, content }) => {
  const componentTemplate = getComponentTemplate(content, name);
  const componentScript = getComponentScript(content, name);

  return {
    template: componentTemplate && {
      file: componentTemplate.path,
      content: componentTemplate.content,
      program: parseVueFile(componentTemplate.content),
      offset: componentTemplate.offset,
    },
    script: componentScript && {
      file: componentScript.path,
      content: componentScript.content,
      program: parseModule(componentScript.content),
      offset: componentScript.offset,
    },
  };
}

export const getComponentOption = (exportDeclaration, optionName) => {
  return exportDeclaration.declaration.properties.find(prop => prop.key.name === optionName);
}

export const isPropertyName = (name) => (prop) => prop.key && prop.key.name === name;

export  const getLastExpression = (functionExpression) => {
  return functionExpression.body.body.at(-1);
}

const applyOrEquals = (assertion, ...assertionTarget) => {
  return typeof assertion === 'function' ? assertion(...assertionTarget) : assertion === assertionTarget[0];
};

export const matchComponentWithProp = ({
  program,
  source,
  matchComponent,
  matchProp,
  matchValue,
  propMatchers,
  visit
}) => {
  propMatchers = propMatchers || [{
    key: matchProp,
    value: matchValue,
  }];
  vueParser.AST.traverseNodes(program.templateBody, {
    enterNode(node, parent) {
      if (node.type === 'VStartTag' && applyOrEquals(matchComponent, normalizeComponentName(parent.name), parent)) {
        const matchedAttr = node.attributes.find(attr => {
          const attrName = toCamelCase(attrKey(attr, source));

          return propMatchers.every(matcher => {
            if (applyOrEquals(matcher.key, attrName, attr)) {
              let isCorrectValue;
              const attrValue = attr.value;
              if (!attrValue) {
                isCorrectValue = applyOrEquals(matcher.value, attrValue);
              } else {
                isCorrectValue = attrValue.type === 'VLiteral'
                  ? applyOrEquals(matcher.value, attrValue.value)
                  : applyOrEquals(matcher.value, source.substring(...attrValue.range));
              }

              return isCorrectValue;
            }
          });
        });

        if (matchedAttr) {
          visit(node, matchedAttr);
        }
      }
    },
    leaveNode: noop,
  });
}

export const matchAny = () => true;
