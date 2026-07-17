import BankPage from '../practice/BankPage';

export default function Listening() {
  return (
    <BankPage
      title="聽力訓練室"
      sub="新制四題型(TTS 朗讀·對話用兩種聲線):句子應答·二人對話·公告(你的弱點題型)·學術短講·交卷後才看原文"
      tabs={[{ qtype: 'lcr' }, { qtype: 'conversation' }, { qtype: 'announcement' }, { qtype: 'talk' }]}
    />
  );
}
