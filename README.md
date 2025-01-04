# test-driven-ai 

AIと一緒にテスト駆動開発を行うためのVSCodeプラグインです。  
MarketPlaceで公開するために作成したものではありません。

# 機能

* `src/index.test.ts`に実装されたテストコードを満たすコードを`src/index.ts`に生成する
* 生成したコードに対してビルドを実行する
* 生成したコードに対してテストを実行する
* ビルドまたはテストが失敗した場合、`src/index.ts`のコードを修正して再度ビルド＆テストを実行する
* コードの再生成を5回繰り返してもテストが失敗する場合は、コードの再生成をやめる

# プラグインの使い方

## 環境

* 対応言語：Typescript
* テスター：Jset
* `npx tsc`、`npm run test`コマンドが使用できることが前提

## 使い方

`src/index.test.ts`にテストコードを実装後、`src/index.test.ts`をテキストエディタでアクティブにした状態でナビゲーションバー上のtest driven AI codingボタンを押すと、AIによるコード生成が始まります。