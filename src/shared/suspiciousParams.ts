// Parameter names worth highlighting in traffic: fuzzing wordlists grouped by the
// vulnerability class they usually probe. Names are stored without the trailing `=`.
import type { Transaction } from './model'

export const paramCategoryLabels = {
    ssrf: 'SSRF',
    sqli: 'SQLi',
    xss: 'XSS',
    lfi: 'LFI',
    redirect: 'OpenRedirect',
    rce: 'RCE'
} as const
export type ParamCategory = keyof typeof paramCategoryLabels

const lists: Record<ParamCategory, string> = {
    ssrf: `dest= redirect= uri= path= continue= url= window= next= data= reference= site= html= val=
        validate= domain= callback= return= page= feed= host= port= to= out= view= dir= target= rurl=
        destination= redir= redirect_uri= redirect_url= image_url= go= returnTo= return_to=
        checkout_url= return_path= forward= file= folder= load= fetch= resource= src= source= link=
        href= proxy= request= service= endpoint= api= webhook= notify= ping= callback_url= success=
        failure= cancel= done= complete= goto= navigate= open= show= display= include= import=
        download= upload= sync= connect= remote= external= internal= server= client= url_callback=
        redirect_to= return_url= next_url= prev= previous= back= backurl= back_url= forward_url=
        target_url= dest_url= destination_url= out_url= outbound= inbound= relay= tunnel= gateway=
        bridge= agent= worker= task=`,
    sqli: `id= page= report= dir= search= category= file= class url= news= item= menu= lang= name= ref=
        title= view= topic= thread= type= date= form= main= nav= region= user= username= pass=
        password= email= login= query= q= s= keyword= keywords= filter= sort= order= by= field=
        table= column= db= database= sql= select= insert= update= delete= drop= create= alter=
        truncate= exec= execute= union= join= group= having= limit= offset= start= end= from= to=
        where= and= or= not= null= true= false= count= sum= avg= min= max= length= substr=
        substring= ascii= char= concat= cast= convert= hex= unhex= md5= sha1= sha256= version=
        current_user= session_user= system_user= schema= information_schema= mysql= pg= sqlite=`,
    xss: `q= s= search= id= lang= keyword= query= page= keywords= year= view= email= type= name= p=
        month= image= list_type= url= terms= categoryid= key= l= begindate= enddate= comment=
        message= msg= text= content= body= title= subject= description= desc= summary= note= notes=
        feedback= review= rating= vote= poll= answer= question= reply= post= thread= topic= forum=
        board= category= tag= tags= label= labels= filter= sort= order= by= field= table= column=
        db= database= sql= select= insert= update= delete= drop= create= alter= truncate= exec=
        execute= union= join= group= having= limit= offset= start= end= from= to= where= and= or=
        not= null= true= false= count= sum= avg= min= max= length= substr=`,
    lfi: `cat= dir= action= board= date= detail= file= download= path folder= prefix= include= page=
        inc= locate= show= doc= site= type= view= content= document= layout= mod= conf= config=
        configuration= settings= setting= option= options= param= parameter= arg= argument= input=
        output= data= value= key= name= id= user= username= pass= password= email= login= query= q=
        s= search= keyword= keywords= filter= sort= order= by= field= table= column= db= database=
        sql= select= insert= update= delete= drop= create= alter= truncate= exec= execute= union=
        join= group= having= limit= offset= start= end= from= to= where= and= or= not= null= true=
        false= count= sum= avg= min= max= length= substr= substring= ascii=`,
    redirect: `next= url= target= rurl= dest= destination= redir= redirect_uri redirect_url=
        redirect= out= view= to= image_url= go= return= returnTo= return_to= checkout_url= continue=
        return_path= forward= file= folder= load= fetch= resource= src= source= link= href= proxy=
        request= service= endpoint= api= webhook= notify= ping= callback= callback_url= success=
        failure= cancel= done= complete= goto= navigate= open= show= display= include= import=
        download= upload= sync= connect= remote= external= internal= server= client= url_callback=
        redirect_to= return_url= next_url= prev= previous= back= backurl= back_url= forward_url=
        target_url= dest_url= destination_url= out_url= outbound= inbound= relay= tunnel= gateway=
        bridge= agent= worker= task= job= action= operation= method= route= dispatch= transfer=
        send= receive= post= get= put= delete= patch= head=`,
    rce: `cmd= exec= command= execute= ping= query= jump= code reg= do= func= arg= option= load=
        process= step= read= feature= exe= module= payload= run= print= system= shell= bash= sh=
        zsh= csh= ksh= fish= powershell= pwsh= cmd.exe= command.com= eval= assert= include=
        require= import= call= invoke= apply= bind= connect= open= close= read= write= append=
        create= delete= remove= move= copy= rename= chmod= chown= chgrp= mkdir= rmdir= ls= dir=
        cat= type= more= less= head= tail= grep= find= locate= which= whereis= whoami= id= uname=
        hostname= ifconfig= ipconfig= netstat= ss= lsof= ps= top= kill= pkill= killall= service=
        systemctl= init= reboot= shutdown= halt= poweroff= mount= umount= df= du= free=`
}

/** Base names seen in the source lists, localized as in the original wordlists. */
const translations: Record<string, string[]> = {
    name: ['nombre', 'nom', 'name', 'mingzi', 'namae', 'ireum', 'ism'],
    page: ['pagina', 'page', 'seite', 'yemian', 'peeji', 'peiji', 'safha'],
    search: ['buscar', 'recherche', 'suche', 'sousuo', 'kensaku', 'geomsaek', 'bahth'],
    file: ['archivo', 'fichier', 'datei', 'wenjian', 'fairu', 'pail', 'milaff'],
    path: ['ruta', 'chemin', 'pfad', 'lujing', 'pasu', 'gyeongno', 'masar'],
    user: ['usuario', 'utilisateur', 'benutzer', 'yonghu', 'yuza', 'sayongja', 'mustakhdim'],
    password: [
        'contrasena',
        'motdepasse',
        'passwort',
        'mima',
        'pasuwado',
        'bimilbeonho',
        'kalimatalsir'
    ],
    email: ['correo', 'courriel', 'email', 'youxiang', 'meeru', 'imeil', 'barid'],
    query: ['consulta', 'requete', 'abfrage', 'chaxun', 'kueri', 'jillyo', 'istifham'],
    view: ['vista', 'vue', 'ansicht', 'shitu', 'byu', 'byu', 'manzar'],
    type: ['tipo', 'type', 'typ', 'leixing', 'taipu', 'taip', 'naw'],
    action: ['accion', 'action', 'aktion', 'dongzuo', 'akushon', 'haengdong', 'ijra'],
    command: ['comando', 'commande', 'befehl', 'mingling', 'komando', 'myeongryeong', 'amr'],
    exec: ['ejecutar', 'executer', 'ausfuhren', 'zhixing', 'jikkou', 'silhaeng', 'tanfidh'],
    category: ['categoria', 'categorie', 'kategorie', 'fenlei', 'kategori', 'kategorie', 'fia'],
    keyword: [
        'palabraclave',
        'motcle',
        'schlusselwort',
        'guanjianci',
        'kiwado',
        'kiwodeu',
        'kalimamiftah'
    ],
    content: ['contenido', 'contenu', 'inhalt', 'neirong', 'kontentsu', 'naeyong', 'muhtawa'],
    title: ['titulo', 'titre', 'titel', 'biaoti', 'taitoru', 'jaeMok', 'unwan'],
    date: ['fecha', 'date', 'datum', 'riqi', 'hidzuke', 'naljja', 'tarikh'],
    download: [
        'descargar',
        'telecharger',
        'herunterladen',
        'xiazai',
        'dauNrodo',
        'daunrodo',
        'tanzil'
    ],
    upload: ['subir', 'televerser', 'hochladen', 'shangchuan', 'appuRodo', 'eopRodo', 'raf'],
    config: [
        'configuracion',
        'configuration',
        'konfiguration',
        'peizhi',
        'settei',
        'seoljeong',
        'takhyeet'
    ],
    option: ['opcion', 'option', 'option', 'xuanxiang', 'opushon', 'opsyeon', 'khayar'],
    id: ['id'],
    url: ['url'],
    cmd: ['cmd'],
    address: ['direccion', 'adresse', 'adresse', 'dizhi', 'adoresu', 'juso', 'unwan'],
    host: ['host', 'hote', 'host', 'zhuji', 'hosuto', 'hoseuteu', 'mudif'],
    port: ['puerto', 'port', 'port', 'duankou', 'poto', 'poteu', 'minaa'],
    domain: ['dominio', 'domaine', 'domain', 'yuming', 'domain', 'domin', 'majal'],
    callback: ['devolucion', 'rappel', 'ruckruf', 'huidiao', 'kosui', 'kaejeon', 'ittisal'],
    return: ['retorno', 'retour', 'ruckgabe', 'fanhui', 'ritan', 'banhwan', 'awda'],
    redirect: [
        'redirigir',
        'rediriger',
        'umleiten',
        'zhongdingxiang',
        'ridairekuto',
        'lideurekto',
        "i'adat"
    ],
    include: ['incluir', 'inclure', 'einbinden', 'baohan', 'inkuruudo', 'poham', 'tadmin'],
    load: ['cargar', 'charger', 'laden', 'jiazai', 'roodo', 'rodeu', 'tahmil'],
    save: ['guardar', 'sauver', 'speichern', 'baocun', 'seebu', 'jeojang', 'hifz'],
    delete: ['borrar', 'supprimer', 'loschen', 'shanchu', 'sakujo', 'sakje', 'hadhf'],
    update: [
        'actualizar',
        'mettreajour',
        'aktualisieren',
        'gengxin',
        'koshin',
        'eopdeiteu',
        'tahdeeth'
    ],
    create: ['crear', 'creer', 'erstellen', 'chuangjian', 'sakusei', 'saengseong', 'insha'],
    read: ['leer', 'lire', 'lesen', 'duqu', 'riido', 'ilgi', 'qiraa'],
    write: ['escribir', 'ecrire', 'schreiben', 'xieru', 'raito', 'sseugi', 'kitaba']
}

const lookup = new Map<string, Set<ParamCategory>>()
for (const [category, list] of Object.entries(lists) as [ParamCategory, string][]) {
    for (const raw of list.split(/\s+/)) {
        const base = raw.replace(/=$/, '').toLowerCase()
        if (!base) continue
        for (const name of [base, ...(translations[base] ?? [])]) {
            const key = name.toLowerCase()
            const categories = lookup.get(key) ?? new Set<ParamCategory>()
            categories.add(category)
            lookup.set(key, categories)
        }
    }
}

/** Categories a parameter name belongs to, with the localized names folded in. */
export function paramCategories(name: string): ParamCategory[] {
    return [...(lookup.get(name.trim().replace(/=$/, '').toLowerCase()) ?? [])]
}

/** Human-readable category labels for the inspector and the sequence table. */
export function paramCategoryLabel(name: string): string | undefined {
    const categories = paramCategories(name)
    return categories.length
        ? categories.map((category) => paramCategoryLabels[category]).join(', ')
        : undefined
}

/** Categories hit by a request's query string and URL-encoded form fields. */
export function suspiciousCategories(
    request: Pick<Transaction, 'url' | 'requestHeaders' | 'requestBody' | 'requestBinary'>
): string[] {
    const names: string[] = []
    try {
        names.push(...new URL(request.url).searchParams.keys())
    } catch {
        // An incomplete URL still has its form fields.
    }
    if (!request.requestBinary) {
        const type = Object.entries(request.requestHeaders ?? {}).find(
            ([key]) => key.toLowerCase() === 'content-type'
        )?.[1]
        if (type?.toLowerCase().includes('x-www-form-urlencoded'))
            names.push(...new URLSearchParams(request.requestBody).keys())
    }
    const found = new Set<string>()
    for (const name of names) {
        for (const category of paramCategories(name)) found.add(paramCategoryLabels[category])
    }
    return [...found]
}
