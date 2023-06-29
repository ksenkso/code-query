import { allVueFiles, iterateFiles, logSet, normalizeComponentName } from '../utils';
import {
  ComponentStruct,
  enterComponentDefinition,
  getComponentOption,
  getObjectPropertyKey,
  getPropsList,
  resolveComponentStruct
} from '../selection';
import { attributesToArray, findInTemplate } from '../dom';
import {
  ArrowFunctionExpression,
  CallExpression,
  isIdentifier,
  isImportDeclaration,
  isObjectExpression,
  isVariableDeclaration,
  ObjectProperty,
  StringLiteral
} from '@babel/types';
import fs from 'fs/promises';
import path from 'path';

export const getOrCompute = <Key, Value>(map: Map<Key, Value>, key: Key, compute: () => Value) => {
  if (!map.has(key)) {
    map.set(key, compute())
  }

  return map.get(key) as Value;
}

const ignoredAttrs = ['class', 'style', 'id', 'v-if', 'v-else', 'v-for', 'key', 'v-else-if', 'v-model', 'ref', 'slot', 'v-html'];

export const findComponentsWithNonPropBindings = async () => {
  const componentToAttrs = new Map<string, Set<string>>();
  const componentToProps = new Map<string, Set<string>>();
  const sources = allVueFiles();

  await iterateFiles(sources, async (file) => {
    const componentStruct = resolveComponentStruct(file);
    if (!componentStruct.template?.content) return;

    const { result: componentsInTemplate } = findInTemplate(componentStruct.template.content, '*');
    for (const ref of componentsInTemplate) {
      const normalizedName = normalizeComponentName(ref.tagName);
      const entry = getOrCompute(componentToAttrs, normalizedName, () => new Set<string>())
      attributesToArray(ref.attributes).forEach(attr => {
        const attrName = attr.name.startsWith(':') ? attr.name.substring(1) : attr.name;
        if (ignoredAttrs.includes(attrName)) return;
        if (attrName.startsWith('@') || attrName.startsWith('vmodel:')) return;
        entry.add(normalizeComponentName(attrName));
      });

      if (componentToProps.has(normalizedName)) continue;

      const refComponentStruct = await resolveComponentFromContext(normalizedName, componentStruct);
      if (!refComponentStruct || !refComponentStruct.script) continue;
      enterComponentDefinition(refComponentStruct.script.program, refDefinition => {
        const propsList = getPropsList(refDefinition);
        componentToProps.set(normalizedName, new Set(propsList.map(normalizeComponentName)));
      });
    }
  });

  componentToProps.forEach((_, componentName) => {
    const componentProps = getOrCompute(componentToProps, componentName, () => new Set());
    const attrs = getOrCompute(componentToAttrs, componentName, () => new Set());
    componentProps.forEach(prop => {
      attrs.delete(prop);
    });
    if (attrs.size) {
      console.log(`Attrs used on component ${componentName}:`);
      logSet(attrs);
    }
  });
}

const globalComponents = [
  'router-link',
  'router-view',
  'slot',
  'template',
  'keep-alive',
  'teleport',
  'component',
  'TMWarningIcon',
  'TMWarningIcon',
  'TMHelpIcon',
  'TMRefreshserCommentsUpIcon',
  'TMRefreshserCommentsIcon',
  'TMExpiredCompanyIcon',
  'TMArrowRight',
  'TMDoneIcon',
  'TMPlusIcon',
  'TMGalleryNavArrow',
  'TMCuratorIcon',
  'TMExternalIcon',
  'TMExternalIcon',
  'TMServicesIcons',
  'TMExternalIcon',
  'TMExternalIcon',
  'TMShareIcon',
  'TMDoneIcon',
  'svgSpritePath',
  'TMRefreshIcon',
  'TMFollowRulesIcon',
  'TMFollowAdviceIcon',
  'TMUseHubIcon',
  'TMImageSizeIcon',
  'TMFailPlaceholderImg',
  'TMDragIcon',
  'TMDragIcon',
].map(normalizeComponentName)

export const resolveComponentPath = (source: string, contextFile: string) => {
  let resolvedPath;
  if (!source.startsWith('.') && !source.startsWith('@/')) {
    resolvedPath = path.resolve(process.env.PROJECT_ROOT as string, 'node_modules', source)
  } else if (source.startsWith('@/')) {
    resolvedPath = source.replace('@/', path.resolve(process.env.PROJECT_ROOT as string, 'src') + '/');
  } else {
    resolvedPath = path.resolve(path.dirname(contextFile), source);
  }

  if (!path.extname(resolvedPath)) {
    resolvedPath += '.vue';
  }

  return resolvedPath;
}

export const resolveComponentFromContext = async (componentName: string, context: ComponentStruct): Promise<ComponentStruct | null> => {
  if (globalComponents.includes(componentName)) return null;
  if (!context.script?.program) return null;

  let importName = '';
  enterComponentDefinition(context.script.program, definition => {
    const definedComponents = getComponentOption(definition, 'components') as ObjectProperty | undefined;
    if (!definedComponents) return;
    if (!isObjectExpression(definedComponents.value)) return;

    const definedComponent = definedComponents.value.properties.find(prop => {
      const propKey = getObjectPropertyKey(prop);
      return propKey && normalizeComponentName(propKey) === componentName;
    });
    if (!definedComponent) {
      return;
    }
    if ('value' in definedComponent) {
      if (isIdentifier(definedComponent.value)) {
        importName = definedComponent.value.name;
      }
    }
  });

  if (!importName) {
    return null;
  }
  for (const bodyElement of context.script.program.program.body) {
    if (bodyElement.type === 'ExportDefaultDeclaration') break;
    let componentImportPath;
    if (isImportDeclaration(bodyElement)) {
      if (bodyElement.specifiers.some(spec => spec.local.name === importName)) {
        componentImportPath = bodyElement.source.value;
      }
    }

    if (
      isVariableDeclaration(bodyElement) &&
      isIdentifier(bodyElement.declarations[0].id) &&
      bodyElement.declarations[0].id.name === 'defineAsyncComponent'
    ) {
      const call = bodyElement.declarations[0].init as CallExpression;
      componentImportPath = (((call.arguments[0] as ArrowFunctionExpression).body as CallExpression).arguments[0] as StringLiteral).value;
    }

    if (componentImportPath) {
      const resolvedFilePath = resolveComponentPath(componentImportPath, context.script.path);

      return fs.readFile(resolvedFilePath, 'utf8')
        .then(content => {
          return resolveComponentStruct({
            path: resolvedFilePath,
            content,
          })
        })
    }
  }

  return null;
}
