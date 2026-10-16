from collocations.oanc import metadata,LICENSE


def test_original_publication_date_not_header_creation_date():
    header='''<cesHeader xmlns="http://www.xces.org/ns/GrAF/1.0/" date.created="2005-09-05">
    <fileDesc><sourceDesc><title>A real title</title><author>A Writer</author>
    <pubDate value="1999-03-09"/><pubPlace>http://www.slate.com/</pubPlace>
    </sourceDesc></fileDesc></cesHeader>'''
    name="OANC-GrAF/data/written_1/journal/slate/1/Article247_4.txt"
    result=metadata(header,name)
    assert result["year"]==1999
    assert result["author"]=="A Writer"
    assert result["register"]=="magazine"
    assert result["country"] is None
    assert result["domain"]=="www.slate.com"
    assert "document=" in result["source_url"]
    assert result["source_url"]!="http://www.slate.com/"
    assert result["text_license"]==LICENSE


def test_broken_header_does_not_invent_metadata():
    result=metadata("<cesHeader><fileDesc>","OANC-GrAF/data/written_2/technical/government/Budget.txt")
    assert result["year"] is None
    assert result["author"] is None
    assert result["raw_metadata"]["header_parse_error"]
    assert result["register"]=="technical"


def test_spoken_not_assumed_american_dialect_per_speaker():
    result=metadata('<cesHeader xmlns="http://www.xces.org/ns/GrAF/1.0/"/>',
                    "OANC-GrAF/data/spoken/telephone/switchboard/sw123.txt")
    assert result["register"]=="spoken"
    assert result["country"] is None


def test_chapters_group_by_isbn_not_filename_or_chapter_title():
    template='''<cesHeader xmlns="http://www.xces.org/ns/GrAF/1.0/"><fileDesc><sourceDesc>
    <title>A Stitch in Time: Chapter {n}</title><idno type="ISBN">0-19-512615-7</idno>
    </sourceDesc></fileDesc></cesHeader>'''
    first=metadata(template.format(n=1),"OANC-GrAF/data/written_2/non-fiction/OUP/Abernathy/ch1.txt")
    second=metadata(template.format(n=2),"OANC-GrAF/data/written_2/non-fiction/OUP/Abernathy/ch2.txt")
    assert first["source_url"]!=second["source_url"]
    assert first["source_document_key"]==second["source_document_key"]=="isbn:0195126157"
