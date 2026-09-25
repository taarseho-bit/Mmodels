import { useState } from 'react';
import { GalleryPage } from './GalleryPage';
import { DatabasePage } from './DatabasePage';
import { DataPlotPanel } from '../components/DataPlotPanel';

type Tab = 'charts' | 'plot' | 'data';

/** 把"项目数据"和"推荐图表"放在同一个工作区，避免用户来回切设置分区。 */
export function DataChartStudioPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('charts');
  return (
    <div className="data-chart-studio">
      <header className="data-chart-head">
        <div>
          <strong>数据与图表</strong>
          <small>先看数据结构，再选择适合数学建模的表达方式</small>
        </div>
        <div className="data-chart-tabs" role="tablist" aria-label="数据与图表">
          <button className={tab === 'charts' ? 'active' : ''} onClick={() => setTab('charts')} role="tab" aria-selected={tab === 'charts'}>推荐图表</button>
          <button className={tab === 'plot' ? 'active' : ''} onClick={() => setTab('plot')} role="tab" aria-selected={tab === 'plot'}>数据绘图</button>
          <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')} role="tab" aria-selected={tab === 'data'}>当前项目数据</button>
        </div>
      </header>
      <div className="data-chart-body" style={{ display: tab === 'plot' ? 'flex' : undefined, flexDirection: 'column', minHeight: 0 }}>
        {tab === 'charts' ? <GalleryPage /> : tab === 'plot' ? <DataPlotPanel active={tab === 'plot'} /> : <DatabasePage />}
      </div>
    </div>
  );
}
