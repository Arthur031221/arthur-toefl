import BankPage from '../practice/BankPage';

export default function Reading() {
  return (
    <BankPage
      title="閱讀訓練室"
      sub="新制三題型:完形填空(打字補完,≤2分/篇)·日常生活閱讀(≤45秒/題)·學術短文(200字5題)·全部可 AI 無限出題"
      tabs={[{ qtype: 'ctw' }, { qtype: 'daily_life' }, { qtype: 'academic' }]}
    />
  );
}
