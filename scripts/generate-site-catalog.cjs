#!/usr/bin/env node
/**
 * 从桌面端真实内置目录生成官网可读的静态目录数据。
 *
 * 这个脚本只读取资源，不执行技能、连接器或任何用户代码。运行后生成
 * docs/catalog-data.js，官网在静态托管环境中也能展示完整目录。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'catalog-data.js');

function loadTypeScriptModule(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require, console }, { filename: relativePath });
  return module.exports;
}

function readFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      id: path.basename(path.dirname(filePath)),
      name: path.basename(path.dirname(filePath)),
      description: '内置数学建模技能。',
    };
  }
  const source = fs.readFileSync(filePath, 'utf8');
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(source);
  const frontmatter = match?.[1] ?? '';
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() || path.basename(path.dirname(filePath));
  const description = /^description:\s*(.*)$/m.exec(frontmatter)?.[1]?.trim() || '内置数学建模技能。';
  return {
    id: path.basename(path.dirname(filePath)),
    name,
    description: description.replace(/^['"]|['"]$/g, ''),
  };
}

function readSkills() {
  const root = path.join(ROOT, 'resources', 'builtin-skills');
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFrontmatter(path.join(root, entry.name, 'SKILL.md')))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function readTemplates() {
  const root = path.join(ROOT, 'resources', 'builtin-skills', 'write-paper', 'assets', 'template');
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'template.json')))
    .map((entry) => {
      const json = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'template.json'), 'utf8'));
      return {
        id: entry.name,
        name: json.name?.['zh-CN'] || entry.name,
        description: json.description?.['zh-CN'] || '内置论文模板。',
        language: json.language || 'zh-CN',
        entryFile: json.entryFile || 'document.tex',
        defaultFor: json.defaultFor || [],
        fields: (json.fields || []).map((field) => field.label?.['zh-CN'] || field.id).filter(Boolean),
      };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
}

function buildCatalog() {
  const algorithmsModule = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'algorithms', 'catalog.json'), 'utf8'));
  const galleryModule = loadTypeScriptModule('src/shared/gallery-data.ts');
  const connectorModule = loadTypeScriptModule('src/shared/connector-catalog.ts');
  const pricingModule = loadTypeScriptModule('src/shared/skill-pricing.ts');
  const pricingById = new Map((pricingModule.SKILL_POINT_CATALOG || []).map((item) => [item.id, item]));
  const skills = readSkills().map((item) => {
    const pricing = pricingById.get(item.id);
    return {
      ...item,
      name: pricing?.label || item.name,
      description: pricing?.description || item.description,
      group: pricing?.group || '其他',
      cost: pricing?.cost ?? null,
    };
  });
  const charts = (galleryModule.GALLERY || []).map((item) => ({
    id: item.id,
    name: item.title,
    description: item.description,
    category: item.category,
    tags: item.tags || [],
    library: item.library,
    dataTypes: item.dataTypes || [],
    image: item.image || '',
    imageAvailable: Boolean(item.image && fs.existsSync(path.join(ROOT, 'docs', 'assets', 'gallery', item.image))),
    source: item.library,
  }));
  const connectors = (connectorModule.CONNECTOR_CATALOG || []).map((item) => ({
    id: item.key,
    name: item.displayName,
    description: item.description,
    category: item.category,
    capabilities: item.capabilities || [],
    sourceUrl: item.sourceUrl || '',
    readOnly: Boolean(item.readOnly),
    auth: item.auth,
    native: Boolean(item.native),
  }));
  return {
    generatedAt: new Date().toISOString(),
    version: require(path.join(ROOT, 'package.json')).version,
    counts: {
      skills: skills.length,
      algorithms: algorithmsModule.algorithms.length,
      charts: charts.length,
      connectors: connectors.length,
      templates: readTemplates().length,
    },
    skills,
    algorithms: algorithmsModule.algorithms.map((item) => ({
      id: item.id,
      name: item.name,
      task: item.task,
      summary: item.summary,
      suitableFor: item.suitableFor || [],
      inputs: item.inputs || [],
      outputs: item.outputs || [],
      notFor: item.notFor || [],
      packageName: item.packageName,
      versionRange: item.versionRange,
      license: item.license,
      docs: item.docs,
    })),
    charts,
    connectors,
    templates: readTemplates(),
  };
}

const catalog = buildCatalog();
const output = `/* Generated by scripts/generate-site-catalog.cjs. Do not edit manually. */\nwindow.MM_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`;
fs.writeFileSync(OUT, output, 'utf8');
console.log(`[site-catalog] generated ${OUT}`);
console.log(`[site-catalog] skills=${catalog.counts.skills} algorithms=${catalog.counts.algorithms} charts=${catalog.counts.charts} connectors=${catalog.counts.connectors} templates=${catalog.counts.templates}`);
