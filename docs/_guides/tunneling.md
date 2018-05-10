---
title: Tunneling (ngrok)
---

# Using Steno with tunnels for development

If you're developing an app which deals with incoming requests from the Events API, from interactive messages, or from slash commands; you'll typically use a service such as [ngrok](https://ngrok.com/) to tunnel requests from a public URL into your local development system.

Before we proceed, familiarize yourself with [using ngrok to develop locally for Slack](https://api.slack.com/tutorials/tunneling-with-ngrok). At the end of that tutorial, you'll have a set up which looks like this:

<div class="mxgraph" style="max-width:100%;border:1px solid transparent;" data-mxgraph="{&quot;highlight&quot;:&quot;#C30000&quot;,&quot;nav&quot;:true,&quot;resize&quot;:true,&quot;toolbar&quot;:&quot;zoom layers lightbox&quot;,&quot;edit&quot;:&quot;_blank&quot;,&quot;xml&quot;:&quot;&lt;mxfile userAgent=\&quot;Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.139 Safari/537.36\&quot; version=\&quot;8.6.2\&quot; editor=\&quot;www.draw.io\&quot; type=\&quot;github\&quot;&gt;&lt;diagram id=\&quot;9563a4d7-6fe5-f838-3f47-fd0226fc76cd\&quot; name=\&quot;Page-1\&quot;&gt;7Vnbbts4EP0aA+1DBV0syX50nPQCZLFBvN12nwpKoiUilKhS9CX79TukKFkXpnUbNekC8UNCniGH1JxDDceeeev8+I6jMvuDJZjOXDs5zrzLmesu/QX8lcB9DYS2VwMpJ0kNOSdgQ/7FGrQ1uiMJrnoDBWNUkLIPxqwocCx6GOKcHfrDtoz2Vy1RikfAJkZ0jH4iichqdOHbJ/w9JmnWrOzY2hKh+C7lbFfo9Waut1Wf2pyjxpceX2UoYYcO5F3NvDVnTNSt/LjGVIa2CVs97+0D1nbfHBfinAluPWGP6A43Ow4oTL3YMvAAGxT3OijB1x1rDG8qRdkKBrjz8ngyQivV/5WXqAFWZdlgsJtoOA6wesEGdntruyqkWG7aBvMhIwJvShRL6wEUCFgmcgo9B5qV4OyuJc6TeyaUrhllXHkDSnAQx+3IjiUJl5FttzvoBlLHdo+5wMcOpAP7DrMcC34PQ7S14VifgbnuHk6CcpohWVdMgQaRFnHaej4RCQ3NpZlX79G8OouzeP1rByeQmqm1XxVwFu5ePw/J2El8HJpIXgahh4JpSJ4PWG4p7dC8MLC8mIDk+VMd3g2F19rvc3wThBdb4/EN4gWOttMwG9rPeH59A7WDmOIiWclUB72YoqoicT+M+EjE5077Hxl9CzxDt4DtfNZsqE7H2A+/+61gVmzHY9zLJALxFIuePnHSS7bjgHci6hsC2mAcUyTIvp+iTUHWK9wwok6B+XUM/PY91A+jJ3VT5sBPOPDjDvzUERj5UYy3D32WCILHi2BMZiMLuyeLsCcLpy8L/1wNzMca8F408CgNhE+ngW9JIDxbA95YA+6LBh6lAWd8S8+EkKXQSrp131qWVckUbcUsr7ttCucP5uTvZeEMldKSH1NZ4lkRAmFZKpHfQsm1RpSynXSsij5PSklVe47KIXVF58jrV1Tn/uuo8fws2dyZD+gyZPO5QXRTJHNnfBsf8aduyhZh/wP6KCn/7rTfPyetfjC4fgdPyKuxyhrQJB+FxIheowjTG1YRQVgBpogJAYfVu2gGrChJpUGws5jMEN1+iQmP5UIXnAmkHS/tARcFK7CJhstweTFVqbsI+izMXcsf8RAaaPD8CWh4uA5KyN5YBsFjiTeojrisg7ja0YOFUFWiosFKxoWa1FY+XWsHVmv30V+wHd+WZcoP7WWgULm46cIw0I9BUnrHlzEIB3ODlnOSJEqfppdVvyacQITLgQj98avAdK0Y5u2fkqCpXvvB71uMpfifO5HCDSKFAbf46w5XojLlBmMV/uoThkLdXt18mLlr5aAqWVFhaH68va5en5Fkfg9tyIfqvLhs9ZlGM973i/z2S+muaOZTiMZU300hmg8F3AN/VjRXe4hm1dXNBoqKDP6vWZ6jIqlqFIvYepGQtC4GVxDD1XIqDUH39NtAXUmcfn/xrv4D&lt;/diagram&gt;&lt;/mxfile&gt;&quot;}"></div>

In the diagram above your app (left) and is running on your local machine and sending its outgoing requests to Slack's URLs: `https://...slack.com/...`. Slack (right) is sending its requests to the URLs you set in your app configuration, ngrok's URLs: `https://...ngrok.io/...`. You are also running ngrok locally, which tunnels requests from those URLs to the port where your app is listening on, in this case port 5000. This would have been accomplished with the command: `ngrok http 5000`.

In order to introduce Steno into the mix, we need to place it between your app and ngrok. The diagram below illustrates this setup:

<div class="mxgraph" style="max-width:100%;border:1px solid transparent;" data-mxgraph="{&quot;highlight&quot;:&quot;#c30000&quot;,&quot;nav&quot;:true,&quot;resize&quot;:true,&quot;toolbar&quot;:&quot;zoom layers lightbox&quot;,&quot;edit&quot;:&quot;_blank&quot;,&quot;xml&quot;:&quot;&lt;mxfile userAgent=\&quot;Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.139 Safari/537.36\&quot; version=\&quot;8.6.2\&quot; editor=\&quot;www.draw.io\&quot; type=\&quot;device\&quot;&gt;&lt;diagram id=\&quot;9563a4d7-6fe5-f838-3f47-fd0226fc76cd\&quot; name=\&quot;Page-1\&quot;&gt;7Vptc6M2EP41nmk/nAcQrx8d53L34TpzU3fa66eOANloIiMKcuz011cCgRHICY7xy+XOk4lhV1qJfZ5d7dqegPl69ymHWfIbjRGZWEa8m4D7iWUFjs//C8FzJfAMUAlWOY4rkbkXLPB/SAoNKd3gGBXKQEYpYThThRFNUxQxRQbznG7VYUtK1FUzuEI9wSKCpC/9C8csqaS+Y+zlnxFeJfXKpiE1IYweVzndpHK9iQWW5atSr2FtS44vEhjTbUsEPk7APKeUVVfr3RwR4drabdW8hwPaZt85StmQCZZXzXiCZIPqLbuEz71bUm6C75A9S6+4/25orfhQlJjN+ADLznZ7Jb9ayffSSlgLZllWy/h2wu44LqsWrMWWsrZV+hSJXRtcvU0wQ4sMRkK75RTksoStCb8z+WXBcvrYIAfEnjEhc0poXlrjmCA3ipqRLU3sBaFhNDtoe1I69wnlDO1aIunZT4iuEcuf+RCptZxqhgwCW2K+3TPKrHmQtNnkSiGULF41lvdI8gsJ5gFg/ZOBNf1BwP6x4TFI9Ngav6Q8Gh5/vQ7KyIwd5OlQDlwPQHcclO0OzA2mLZx9Dcz+GCgHlwrfBeGZ7XYCOIbIX2oD2I18FC7HgdYzrhjBwNBg23EqSuOZOO74XURgUeBI9SPaYfatdf23cP+UE5bfpnw/3yQc5U1LqfrfesmbBd3kEVJPEwbzFZLDgKQoipUjt+/zllMdjU9rWY4IZPhJPah1fpYrfKW4DAR9TuYQqxaqx5GT2gdnx47XsWN17FQu6NkpQW8eehgPatqewIM+njUzDIUZnsIMU2WGM5gGQZ8G9Xn0kwZvpQHo0SBhLCuT+AP/I5SXrwktuJ9mwBD16MN0Om3yeH4wMb+WihOYCc16txKl/jSEnF3TMpv/zkvvOSSEboThsvgHgk9l1W+WeaSq7E1xCIfVAfAlrC1fJaWbdgcxTUq3NbwbJaPbWgiLBkMOWFkvTTH9DuAjOPuzdf35mrA6bqcIcy+Jq/N6hhaPgnmEfoEhIl9pgRmmKVeFlDG65k6oB8wIXgkFo4OQTCBZ/hPhPBIL3eWUQWk4MDpYpDRFOhjuveBurI4nMFUUbGvq9HDwNDDULjwJBlcDQxU/MX7S1sL8sdgHWHlcFMN5uaOD1XCRwbSWZTRn5aSm/G1rW+JybVV6hu04Zco/ai8dhorFdVVDhz8aSskd30ecOCjXcHmN47jkpy5ZqY3BGCne6LDQ6ecCXWnRPbvfxMHTG7KBbfeCoZTeTkN2mV4bvN6Q6VrtUfoxe4R+bGgd/lIZ7g2vw2XNfcPtGPAPnNvHFuLduq5naLxK3B6tIWtFiVG+tBQRUawb+dbmfhB3gK6Huy3udHu4YKQezj4fc6zTmfNC467JLifnEC0PvJvigemoAL6VB6bfbQ3PR4QjmnnnnTbzh/rHEcoE85rdoK37Sq0Dk/iKMBv+oM0XnTCsLRgvOgCAazZidv9zjp4HbrcfFvXqTF+vNtC+zsRLuFn3scOP0u8Cw3yn/e4RJGsaXiXYPU2on6vfdQZUNOdOdpYfKM/vgotlOqd/jn+Pma59FPeBajC+iazn6A6X49IMQcsbSnrDdwPe7Wd8R1Ds4jmP3+5/j1XV+vvfvIGP/wM=&lt;/diagram&gt;&lt;/mxfile&gt;&quot;}"></div>

Let's go over the differences:
*  Your app is now sending its requests to Steno's `out-port`, so the URLs now look like `http://localhost:3000/...`.
*  ngrok is now sending its requests to Steno's `in-port`, so the command used to run it is now `ngrok http 3010`.
*  Steno is set to send incoming requests to your app using the option `--app http://localhost:5000/...`.

## Bottom Line

These examples use the default ports for Steno, but here's a helpful summary using the options expliclty. You can replace the values with your own:

```bash
$ steno --replay --app localhost:5000 --out-port 3000 --in-port 3010 # if using --record mode, just omit the --in-port
$ ngrok http 3010
```

<script type="text/javascript" src="https://www.draw.io/js/viewer.min.js"></script>
