import fs from 'fs'
import path from 'path'
import * as parser from '@babel/parser'
import traverseAst, {NodePath, TraverseOptions} from '@babel/traverse'
import {AST, parse as parseVue} from 'vue-eslint-parser'
import {toCamelCase} from './transform'
import {attrKey, FileStruct, noop, normalizeComponentName, VueAttr} from './utils'
import {
  ExportDefaultDeclaration,
  File,
  FunctionExpression, isArrayExpression,
  isObjectExpression, isStringLiteral,
  Node, ObjectExpression,
  ObjectMethod,
  ObjectProperty,
  SpreadElement,
} from '@babel/types'
import { getOrCompute } from './tasks/findComponentsWithNonPropBindings';

export const parseModule = (source: string) => parser.parse(source, {
  sourceType: 'module'
});

export const parseVueFile = (source: string) => parseVue(source, {
  sourceType: 'module',
  ecmaVersion: 'latest',
});

export const traverse = (source: string, options: TraverseOptions) => {
  const ast = parseModule(source);

  traverseAst(ast, options)
}

export const enterComponentDefinition = (
  scriptBody: File,
  visitor: (node: ExportDefaultDeclaration, path: NodePath<ExportDefaultDeclaration>) => void,
) => {
  traverseAst(scriptBody, {
    ExportDefaultDeclaration(path) {
      const { node } = path;

      return visitor(node, path);
    }
  });
}

export const subtraverse = (ast: Node, options: TraverseOptions) => {
  traverseAst(ast, {
    noScope: true,
    ...options,
  });
}

const TEMPLATE_OPEN_TAG = '<template>';
const TEMPLATE_CLOSE_TAG = '</template>';

export const getComponentTemplateStart = (vueFileContent: string) => {
  const scriptIndex =  vueFileContent.indexOf(TEMPLATE_OPEN_TAG);
  if (scriptIndex === -1) return -1;

  return scriptIndex + TEMPLATE_OPEN_TAG.length;
}

export type ComponentPart = {
  path: string;
  content: string;
  offset: number;
};

export const getComponentTemplate = (vueFileContent: string, filePath: string): ComponentPart | null => {
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

export const getComponentScriptStart = (vueFileContent: string) => {
  const scriptIndex =  vueFileContent.indexOf(SCRIPT_OPEN_TAG);
  if (scriptIndex === -1) return -1;

  return scriptIndex + SCRIPT_OPEN_TAG.length;
}

export const getComponentScript = (vueFileContent: string, filePath: string) => {
  let scriptStartIndex = getComponentScriptStart(vueFileContent)
  if (scriptStartIndex === -1) {
    scriptStartIndex = vueFileContent.indexOf(SCRIPT_OPEN_TAG_WITH_SOURCE);
    if (scriptStartIndex === -1) {
      return null;
    }

    const scriptRow = vueFileContent.substring(scriptStartIndex, vueFileContent.indexOf('/>', scriptStartIndex));
    const match = scriptRow.match(SRC_REGEXP);
    if (match) {
      const src = match[1];
      const scriptFilePath = path.resolve(path.dirname(filePath), src);

      return {
        path: scriptFilePath,
        content: fs.readFileSync(scriptFilePath, 'utf8'),
        offset: 0,
      };
    }

    return null;
  }

  return {
    path: filePath,
    content: vueFileContent.substring(scriptStartIndex, vueFileContent.lastIndexOf(SCRIPT_CLOSE_TAG)),
    offset: scriptStartIndex,
  };
}

export type ComponentStruct = {
  template: ComponentPart & { program: AST.ESLintProgram } | null;
  script: ComponentPart & { program: File } | null;
}

const resolvedComponentsCache = new Map<string, ComponentStruct>();

export const resolveComponentStructRaw = (file: Pick<FileStruct, 'path'|'content'>) => {
  const componentTemplate = getComponentTemplate(file.content, file.path);
  const componentScript = getComponentScript(file.content, file.path);

  return {
    template: componentTemplate && {
      path: componentTemplate.path,
      content: componentTemplate.content,
      program: parseVueFile(componentTemplate.content),
      offset: componentTemplate.offset,
    },
    script: componentScript && {
      path: componentScript.path,
      content: componentScript.content,
      program: parseModule(componentScript.content),
      offset: componentScript.offset,
    },
  };
}

export const resolveComponentStruct = (file: Pick<FileStruct, 'path'|'content'>, cache = true): ComponentStruct => {
  if (!cache) {
    return resolveComponentStructRaw(file);
  }

  return getOrCompute(resolvedComponentsCache, file.path, () => resolveComponentStructRaw(file));
}

export const getObjectPropertyKey = (property: ObjectProperty | ObjectMethod | SpreadElement) => {
  if (property.type === 'SpreadElement' || !('name' in property.key)) return null;

  return property.key.name;
}

export const isPropertyName = (name: string) => (prop: ObjectProperty | ObjectMethod | SpreadElement) => {
  return getObjectPropertyKey(prop) === name;
}

export const getObjectPropertyByName = (object: ObjectExpression, name: string) => {
  return object.properties.find(isPropertyName(name)) as ObjectProperty | ObjectMethod | undefined;
}

export const getComponentOption = (exportDeclaration: ExportDefaultDeclaration, optionName: string) => {
  if (!isObjectExpression(exportDeclaration.declaration)) return;

  return getObjectPropertyByName(exportDeclaration.declaration, optionName);
}

export const getPropsList = (exportDeclaration: ExportDefaultDeclaration) => {
  const props = getComponentOption(exportDeclaration, 'props') as ObjectProperty | undefined;
  if (!props) return [];

  if (isObjectExpression(props.value)) {
    return props.value.properties.map(getObjectPropertyKey).filter(Boolean) as string[];
  }

  if (isArrayExpression(props.value)) {
    return props.value.elements.map(el => isStringLiteral(el) ? el.value : null).filter(Boolean) as string[];
  }

  return [];
}

export  const getLastExpression = (functionExpression: FunctionExpression) => {
  return functionExpression.body.body.at(-1);
}

function applyOrEquals(assertion: any, ...assertionTarget: any[]) {
  return typeof assertion === 'function' ? (assertion as Function)(...assertionTarget) : assertion === assertionTarget[0];
}

export type PropMatcher = string | ((expected: string, propName: string, attr: VueAttr) => boolean);
export type PropValueMatcher = string | ((expected: string, value: string) => boolean);

export type MatchComponentWithPropQuery = {
  program: AST.ESLintProgram;
  source: string;
  matchComponent: string | ((expected: string, component: string) => boolean);
  matchProp: PropMatcher;
  matchValue: PropValueMatcher;
  propMatchers?: Array<{ key: PropMatcher, value: PropValueMatcher }>;
  visit: (node: AST.VStartTag, matchedAttr: VueAttr) => void;
}

export const matchComponentWithProp = ({
  program,
  source,
  matchComponent,
  matchProp,
  matchValue,
  propMatchers = [{
    key: matchProp,
    value: matchValue,
  }],
  visit
}: MatchComponentWithPropQuery) => {
  if (!program.templateBody) return;

  AST.traverseNodes(program.templateBody, {
    enterNode(node, parent: AST.Node) {
      if (node.type !== 'VStartTag') return;
      const matchesComponent = applyOrEquals(
        matchComponent,
        normalizeComponentName((parent as AST.VElement).name),
        parent,
      );
      if (!matchesComponent) return;

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
    },
    leaveNode: noop,
  });
}

export const matchAny = () => true;
