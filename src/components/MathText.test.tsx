import {expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {MathText} from './MathText'
it('renders inline and display fractions instead of showing their delimiters',()=>{
 const html=renderToStaticMarkup(<MathText text={String.raw`A. $\frac{\pi}{12}$，B. \(\frac{\pi}{6}\)`}/> )
 expect(html.match(/<mfrac>/g)).toHaveLength(2)
 expect(html).toContain('A. ')
 expect(html).not.toContain('$\\frac')
})
it('escapes text, blocks active links and tolerates malformed math',()=>{
 const html=renderToStaticMarkup(<MathText text={String.raw`<img src=x onerror=alert(1)> $\href{javascript:alert(1)}{x}$ $\frac{1}$`}/> )
 expect(html).not.toContain('<img')
 expect(html).not.toContain('href="javascript:')
})
